use super::*;
use aws_sdk_s3::error::ProvideErrorMetadata;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::Length;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REF_PATH: &str = ".local/references.json";
const PROXY: &str = "http://127.0.0.1:19110";
const PART_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
struct ObjectRef {
    connection_id: String,
    bucket: String,
    object_key: String,
    operation_id: String,
    size: u64,
    sha256: String,
    content_type: String,
    state: String,
    upload_id: Option<String>,
    etag: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct References {
    run_id: String,
    objects: Vec<ObjectRef>,
}

#[derive(Serialize)]
struct Check {
    name: String,
    passed: bool,
    detail: String,
}

#[derive(Serialize)]
struct Report {
    phase: String,
    process_id: u32,
    checks: Vec<Check>,
}

impl Report {
    fn new(phase: &str) -> Self {
        Self {
            phase: phase.into(),
            process_id: std::process::id(),
            checks: vec![],
        }
    }

    fn check(&mut self, name: &str, passed: bool, detail: impl Into<String>) -> Result<()> {
        let detail = detail.into();
        println!("{} {name}: {detail}", if passed { "PASS" } else { "FAIL" });
        self.checks.push(Check {
            name: name.into(),
            passed,
            detail,
        });
        std::fs::create_dir_all("evidence")?;
        std::fs::write(
            format!("evidence/{}.json", self.phase),
            serde_json::to_vec_pretty(self)?,
        )?;
        ensure!(passed, "acceptance assertion failed: {name}");
        Ok(())
    }
}

fn save_refs(refs: &References) -> Result<()> {
    // Flush the file before the next mutating request. This is a validation
    // journal, not a replacement for #11's PostgreSQL transaction design.
    let bytes = serde_json::to_vec_pretty(refs)?;
    let pending = ".local/references.pending.json";
    let mut file = std::fs::File::create(pending)?;
    std::io::Write::write_all(&mut file, &bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(pending, REF_PATH)?;
    Ok(())
}

async fn hash_stream(mut stream: impl tokio::io::AsyncRead + Unpin) -> Result<(u64, String)> {
    let mut hash = Sha256::new();
    let mut count = 0;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = stream.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
        count += read as u64;
    }
    Ok((count, format!("{:x}", hash.finalize())))
}

async fn fixture(path: &str, size: u64) -> Result<(u64, String)> {
    let mut file = tokio::fs::File::create(path).await?;
    let block: Vec<u8> = (0..65536).map(|i| ((i * 31 + 17) % 251) as u8).collect();
    let mut remaining = size;
    while remaining > 0 {
        let n = remaining.min(block.len() as u64) as usize;
        file.write_all(&block[..n]).await?;
        remaining -= n as u64;
    }
    file.sync_all().await?;
    hash_stream(tokio::fs::File::open(path).await?).await
}

async fn initialize(s3: &Client) -> Result<References> {
    tokio::fs::create_dir_all(".local").await?;
    let bucket = s3.create_bucket().bucket(BUCKET).send().on_heap().await;
    if let Err(error) = bucket {
        ensure!(
            error
                .as_service_error()
                .is_some_and(|e| e.is_bucket_already_owned_by_you()),
            "could not create isolated bucket"
        );
    }
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .to_string();
    let (size, sha256) = fixture(".local/small.bin", 131209).await?;
    let object = ObjectRef {
        connection_id: "issue-10-rustfs-local".into(),
        bucket: BUCKET.into(),
        object_key: format!("issue-10/{run_id}/资料 空格+号/small.bin"),
        operation_id: format!("issue-10-{run_id}-small"),
        size,
        sha256,
        content_type: "application/octet-stream".into(),
        state: "receiving".into(),
        upload_id: None,
        etag: None,
    };
    let mut refs = References {
        run_id,
        objects: vec![object],
    };
    save_refs(&refs)?;
    let object = &refs.objects[0];
    let output = s3
        .put_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .content_type(&object.content_type)
        .metadata("issue", "10")
        .metadata("operation-id", &object.operation_id)
        .metadata("sha256", &object.sha256)
        .body(ByteStream::from_path(".local/small.bin").await?)
        .send()
        .on_heap()
        .await?;
    refs.objects[0].etag = output.e_tag().map(str::to_owned);
    verify(s3, &refs.objects[0]).await?;
    refs.objects[0].state = "verified".into();
    save_refs(&refs)?;
    Ok(refs)
}

async fn verify(s3: &Client, object: &ObjectRef) -> Result<()> {
    ensure!(
        object.connection_id == "issue-10-rustfs-local" && object.bucket == BUCKET,
        "storage binding mismatch"
    );
    let head = s3
        .head_object()
        .bucket(&object.bucket)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await?;
    ensure!(
        head.content_length() == Some(object.size as i64),
        "object length mismatch"
    );
    ensure!(
        head.content_type() == Some(object.content_type.as_str()),
        "object content type mismatch"
    );
    let metadata = head.metadata().context("missing object metadata")?;
    ensure!(
        metadata.get("operation-id") == Some(&object.operation_id),
        "operation identity mismatch"
    );
    ensure!(
        metadata.get("sha256") == Some(&object.sha256),
        "content identity mismatch"
    );
    let output = s3
        .get_object()
        .bucket(&object.bucket)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await?;
    let (size, hash) = hash_stream(output.body.into_async_read()).await?;
    ensure!(
        size == object.size && hash == object.sha256,
        "download content mismatch"
    );
    Ok(())
}

async fn safe_send(request: reqwest::RequestBuilder) -> Result<reqwest::Response> {
    request
        .send()
        .on_heap()
        .await
        .map_err(|_| anyhow::anyhow!("HTTP request failed; signed URL omitted"))
}

async fn ranges_and_auth(s3: &Client, object: &ObjectRef, report: &mut Report) -> Result<()> {
    let http = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()?;
    let source = tokio::fs::read(".local/small.bin").await?;
    let signed = s3
        .get_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .presigned(PresigningConfig::expires_in(Duration::from_secs(300))?)
        .await?;
    for (label, range, start, end) in [
        ("middle", "bytes=1000-1511".to_owned(), 1000, 1511),
        (
            "suffix",
            "bytes=-128".to_owned(),
            object.size - 128,
            object.size - 1,
        ),
        (
            "open-end",
            format!("bytes={}-", object.size - 77),
            object.size - 77,
            object.size - 1,
        ),
    ] {
        let output = s3
            .get_object()
            .bucket(BUCKET)
            .key(&object.object_key)
            .range(&range)
            .send()
            .on_heap()
            .await?;
        let expected_content_range = format!("bytes {start}-{end}/{}", object.size);
        let sdk_headers = output.content_range() == Some(expected_content_range.as_str())
            && output.content_length() == Some((end - start + 1) as i64);
        let sdk_bytes = output.body.collect().await?.into_bytes();
        let response = safe_send(http.get(signed.uri()).header("Range", &range)).await?;
        let status = response.status().as_u16();
        let correct_headers = response
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            == Some(expected_content_range.as_str())
            && response.content_length() == Some(end - start + 1);
        let bytes = response
            .bytes()
            .await
            .map_err(|_| anyhow::anyhow!("Range body failed"))?;
        let expected = &source[start as usize..=end as usize];
        report.check(
            &format!("range-{label}-sdk-and-presigned"),
            sdk_headers
                && sdk_bytes.as_ref() == expected
                && status == 206
                && correct_headers
                && bytes.as_ref() == expected,
            format!("HTTP {status}; {expected_content_range}; exact bytes verified"),
        )?;
    }
    let response = safe_send(
        http.get(signed.uri())
            .header("Range", format!("bytes={}-", object.size + 1)),
    )
    .await?;
    report.check(
        "range-out-of-bounds",
        response.status().as_u16() == 416,
        format!("HTTP {}", response.status().as_u16()),
    )?;
    let response = safe_send(http.get(signed.uri())).await?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| anyhow::anyhow!("GET body failed"))?;
    report.check(
        "presigned-get",
        status == 200 && format!("{:x}", Sha256::digest(&bytes)) == object.sha256,
        "HTTP 200; full SHA256 matches; URL intentionally omitted",
    )?;
    let direct_uri = format!("{ENDPOINT}/{BUCKET}/issue-10/probe.bin");
    let anonymous = safe_send(http.get(direct_uri)).await?;
    report.check(
        "anonymous-denied",
        anonymous.status().as_u16() == 403,
        format!("HTTP {}", anonymous.status().as_u16()),
    )?;
    let wrong = Client::from_conf(
        s3.config()
            .clone()
            .to_builder()
            .credentials_provider(Credentials::new(
                std::env::var("ISSUE10_ACCESS_KEY")?,
                "issue-10-deliberately-invalid-secret",
                None,
                None,
                "issue-10-invalid",
            ))
            .build(),
    );
    let error = wrong
        .get_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await
        .expect_err("wrong secret must fail");
    let status = error.raw_response().map(|r| r.status().as_u16());
    report.check(
        "wrong-secret-denied",
        status == Some(403),
        format!("HTTP {status:?}"),
    )?;
    let mut tampered = signed.uri().to_owned();
    let start = tampered
        .find("X-Amz-Signature=")
        .context("missing URL signature")?
        + "X-Amz-Signature=".len();
    let replacement = if &tampered[start..start + 1] == "0" {
        "1"
    } else {
        "0"
    };
    tampered.replace_range(start..start + 1, replacement);
    let response = safe_send(http.get(tampered)).await?;
    report.check(
        "tampered-signature-denied",
        response.status().as_u16() == 403,
        format!("HTTP {}", response.status().as_u16()),
    )?;
    let expired = s3
        .get_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .presigned(
            PresigningConfig::builder()
                .start_time(SystemTime::now() - Duration::from_secs(120))
                .expires_in(Duration::from_secs(60))
                .build()?,
        )
        .await?;
    let response = safe_send(http.get(expired.uri())).await?;
    report.check(
        "expired-url-denied",
        response.status().as_u16() == 403,
        format!("HTTP {}", response.status().as_u16()),
    )?;
    let response = safe_send(http.put(signed.uri()).body("not-authorized-to-write")).await?;
    report.check(
        "get-url-does-not-authorize-put",
        response.status().as_u16() == 403,
        format!("HTTP {}", response.status().as_u16()),
    )?;
    verify(s3, object).await?;
    report.check(
        "denied-write-keeps-object-intact",
        true,
        "HEAD + streamed SHA256 match after denied PUT",
    )?;
    let missing = s3
        .get_object()
        .bucket(BUCKET)
        .key(format!("issue-10/{}/missing", object.operation_id))
        .send()
        .on_heap()
        .await;
    let error = missing.expect_err("missing object must fail");
    let status = error.raw_response().map(|r| r.status().as_u16());
    report.check(
        "missing-object-is-distinct-from-denied",
        status == Some(404),
        format!("HTTP {status:?}"),
    )?;
    Ok(())
}

async fn new_attempt(refs: &mut References, path: &str, label: &str) -> Result<usize> {
    let (size, sha256) = hash_stream(tokio::fs::File::open(path).await?).await?;
    let index = refs.objects.len();
    refs.objects.push(ObjectRef {
        connection_id: "issue-10-rustfs-local".into(),
        bucket: BUCKET.into(),
        object_key: format!("issue-10/{}/{index}-{label}.bin", refs.run_id),
        operation_id: format!("issue-10-{}-{index}", refs.run_id),
        size,
        sha256,
        content_type: "application/octet-stream".into(),
        state: "receiving".into(),
        upload_id: None,
        etag: None,
    });
    save_refs(refs)?;
    Ok(index)
}

async fn begin_multipart(
    s3: &Client,
    refs: &mut References,
    path: &str,
    label: &str,
) -> Result<usize> {
    let index = new_attempt(refs, path, label).await?;
    let object = &refs.objects[index];
    let created = s3
        .create_multipart_upload()
        .bucket(BUCKET)
        .key(&object.object_key)
        .content_type(&object.content_type)
        .metadata("issue", "10")
        .metadata("operation-id", &object.operation_id)
        .metadata("sha256", &object.sha256)
        .send()
        .on_heap()
        .await?;
    refs.objects[index].upload_id =
        Some(created.upload_id().context("missing multipart ID")?.into());
    save_refs(refs)?;
    Ok(index)
}

async fn upload_parts(s3: &Client, object: &ObjectRef, path: &str) -> Result<Vec<CompletedPart>> {
    let mut parts = vec![];
    let mut offset = 0;
    while offset < object.size {
        let length = (object.size - offset).min(PART_SIZE);
        let number = parts.len() as i32 + 1;
        let body = ByteStream::read_from()
            .path(path)
            .offset(offset)
            .length(Length::Exact(length))
            .build()
            .await?;
        let result = s3
            .upload_part()
            .bucket(BUCKET)
            .key(&object.object_key)
            .upload_id(object.upload_id.as_deref().context("missing upload ID")?)
            .part_number(number)
            .body(body)
            .send()
            .on_heap()
            .await?;
        parts.push(
            CompletedPart::builder()
                .part_number(number)
                .e_tag(result.e_tag().context("missing part ETag")?)
                .build(),
        );
        offset += length;
    }
    Ok(parts)
}

async fn invisible(s3: &Client, object: &ObjectRef) -> Result<bool> {
    let head = s3
        .head_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await;
    let get = s3
        .get_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await;
    Ok(head
        .as_ref()
        .err()
        .and_then(|e| e.raw_response())
        .map(|r| r.status().as_u16())
        == Some(404)
        && get
            .as_ref()
            .err()
            .and_then(|e| e.raw_response())
            .map(|r| r.status().as_u16())
            == Some(404))
}

async fn complete(s3: &Client, object: &ObjectRef, parts: Vec<CompletedPart>) -> Result<String> {
    let result = s3
        .complete_multipart_upload()
        .bucket(BUCKET)
        .key(&object.object_key)
        .upload_id(object.upload_id.as_deref().context("missing upload ID")?)
        .multipart_upload(
            CompletedMultipartUpload::builder()
                .set_parts(Some(parts))
                .build(),
        )
        .send()
        .on_heap()
        .await?;
    Ok(result.e_tag().context("missing completed ETag")?.into())
}

async fn multipart(s3: &Client, refs: &mut References, report: &mut Report) -> Result<()> {
    fixture(".local/multipart.bin", 17 * 1024 * 1024 + 123).await?;
    let index = begin_multipart(s3, refs, ".local/multipart.bin", "multipart").await?;
    report.check(
        "multipart-created-is-not-readable",
        invisible(s3, &refs.objects[index]).await?,
        "HEAD/GET 404; state receiving",
    )?;
    let parts = upload_parts(s3, &refs.objects[index], ".local/multipart.bin").await?;
    report.check(
        "all-parts-are-not-a-ready-object",
        parts.len() == 3
            && invisible(s3, &refs.objects[index]).await?
            && refs.objects[index].state == "receiving",
        "3 parts: 8 MiB + 8 MiB + 1048699 bytes; HEAD/GET still 404",
    )?;
    refs.objects[index].state = "unknown".into();
    save_refs(refs)?;
    refs.objects[index].etag = Some(complete(s3, &refs.objects[index], parts).await?);
    verify(s3, &refs.objects[index]).await?;
    refs.objects[index].state = "verified".into();
    save_refs(refs)?;
    report.check(
        "multipart-complete-head-stream-get",
        true,
        "17825915 bytes; SHA256/type/operation metadata verified",
    )?;
    Ok(())
}

async fn abort(s3: &Client, object: &ObjectRef) -> Result<()> {
    s3.abort_multipart_upload()
        .bucket(BUCKET)
        .key(&object.object_key)
        .upload_id(object.upload_id.as_deref().context("missing upload ID")?)
        .send()
        .on_heap()
        .await?;
    Ok(())
}

async fn failures(s3: &Client, refs: &mut References, report: &mut Report) -> Result<()> {
    let first_case = refs.objects.len();
    let index = begin_multipart(s3, refs, ".local/small.bin", "invalid-completion").await?;
    upload_parts(s3, &refs.objects[index], ".local/small.bin").await?;
    let object = &refs.objects[index];
    let error = s3
        .complete_multipart_upload()
        .bucket(BUCKET)
        .key(&object.object_key)
        .upload_id(object.upload_id.as_deref().unwrap())
        .multipart_upload(
            CompletedMultipartUpload::builder()
                .parts(
                    CompletedPart::builder()
                        .part_number(1)
                        .e_tag("\"issue-10-wrong-etag\"")
                        .build(),
                )
                .build(),
        )
        .send()
        .on_heap()
        .await
        .expect_err("invalid part ETag must fail");
    let status = error.raw_response().map(|r| r.status().as_u16());
    let code = error
        .as_service_error()
        .and_then(|e| e.code())
        .unwrap_or("unknown")
        .to_owned();
    refs.objects[index].state = "failed".into();
    save_refs(refs)?;
    report.check(
        "real-invalid-part-is-not-ready",
        status == Some(400) && code == "InvalidPart" && invisible(s3, &refs.objects[index]).await?,
        format!("HTTP {status:?}; {code}; HEAD/GET 404; state failed"),
    )?;
    abort(s3, &refs.objects[index]).await?;

    let index = begin_multipart(s3, refs, ".local/small.bin", "cancelled").await?;
    upload_parts(s3, &refs.objects[index], ".local/small.bin").await?;
    abort(s3, &refs.objects[index]).await?;
    refs.objects[index].state = "cancelled".into();
    save_refs(refs)?;
    let error = s3
        .list_parts()
        .bucket(BUCKET)
        .key(&refs.objects[index].object_key)
        .upload_id(refs.objects[index].upload_id.as_deref().unwrap())
        .send()
        .on_heap()
        .await
        .expect_err("aborted upload must disappear");
    let code = error
        .as_service_error()
        .and_then(|e| e.code())
        .unwrap_or("unknown");
    report.check(
        "abort-removes-unfinished-upload",
        code == "NoSuchUpload" && invisible(s3, &refs.objects[index]).await?,
        format!("{code}; HEAD/GET 404; state cancelled"),
    )?;

    let proxy = client(PROXY)?;
    let index = begin_multipart(s3, refs, ".local/small.bin", "issue-10-embedded-error").await?;
    let parts = upload_parts(s3, &refs.objects[index], ".local/small.bin").await?;
    let object = &refs.objects[index];
    let error = proxy
        .complete_multipart_upload()
        .bucket(BUCKET)
        .key(&object.object_key)
        .upload_id(object.upload_id.as_deref().unwrap())
        .multipart_upload(
            CompletedMultipartUpload::builder()
                .set_parts(Some(parts))
                .build(),
        )
        .send()
        .on_heap()
        .await
        .expect_err("HTTP 200 embedded Error must be an SDK error");
    let status = error.raw_response().map(|r| r.status().as_u16());
    let code = error
        .as_service_error()
        .and_then(|e| e.code())
        .unwrap_or("unknown")
        .to_owned();
    refs.objects[index].state = "failed".into();
    save_refs(refs)?;
    report.check(
        "injected-http200-error-is-not-success",
        status == Some(200) && code == "InvalidPart" && invisible(s3, &refs.objects[index]).await?,
        format!("INJECTED HTTP {status:?}; SDK {code}; no ready object"),
    )?;
    abort(s3, &refs.objects[index]).await?;

    let index = begin_multipart(s3, refs, ".local/small.bin", "unfinished-across-restart").await?;
    upload_parts(s3, &refs.objects[index], ".local/small.bin").await?;
    report.check(
        "unfinished-remains-receiving",
        refs.objects[index].state == "receiving" && invisible(s3, &refs.objects[index]).await?,
        "one uploaded part; no completion; not ready; retained for restart check",
    )?;

    let index = new_attempt(refs, ".local/small.bin", "issue-10-drop-put").await?;
    refs.objects[index].state = "unknown".into();
    save_refs(refs)?;
    let object = &refs.objects[index];
    let error = proxy
        .put_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .content_type(&object.content_type)
        .metadata("issue", "10")
        .metadata("operation-id", &object.operation_id)
        .metadata("sha256", &object.sha256)
        .body(ByteStream::from_path(".local/small.bin").await?)
        .send()
        .on_heap()
        .await
        .expect_err("dropped PUT result must be unknown");
    let transport_error = error.as_service_error().is_none();
    let head = s3
        .head_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await?;
    report.check(
        "put-response-lost-after-real-write",
        transport_error
            && head.content_length() == Some(object.size as i64)
            && object.state == "unknown",
        "client transport error; real service HEAD finds bytes; durable state still unknown",
    )?;

    let index = begin_multipart(s3, refs, ".local/multipart.bin", "issue-10-drop-complete").await?;
    let parts = upload_parts(s3, &refs.objects[index], ".local/multipart.bin").await?;
    refs.objects[index].state = "unknown".into();
    save_refs(refs)?;
    let object = &refs.objects[index];
    let error = proxy
        .complete_multipart_upload()
        .bucket(BUCKET)
        .key(&object.object_key)
        .upload_id(object.upload_id.as_deref().unwrap())
        .multipart_upload(
            CompletedMultipartUpload::builder()
                .set_parts(Some(parts))
                .build(),
        )
        .send()
        .on_heap()
        .await
        .expect_err("dropped completion result must be unknown");
    let transport_error = error.as_service_error().is_none();
    let head = s3
        .head_object()
        .bucket(BUCKET)
        .key(&object.object_key)
        .send()
        .on_heap()
        .await?;
    report.check(
        "complete-response-lost-after-real-completion",
        transport_error
            && head.content_length() == Some(object.size as i64)
            && object.state == "unknown",
        "client transport error; real service has complete bytes; durable state still unknown",
    )?;
    std::fs::write(
        "evidence/references-before-restart.json",
        serde_json::to_vec_pretty(refs)?,
    )?;
    let cases = &refs.objects[first_case..];
    report.check(
        "unknown-and-incomplete-never-ready",
        cases.iter().filter(|o| o.state == "unknown").count() == 2
            && cases.iter().filter(|o| o.state == "receiving").count() == 1,
        "new cases persist 2 unknown + 1 receiving; none is verified",
    )?;
    Ok(())
}

async fn resume(s3: &Client, refs: &mut References, report: &mut Report) -> Result<()> {
    let previous: serde_json::Value =
        serde_json::from_slice(&std::fs::read("evidence/failures.json")?)?;
    report.check(
        "new-program-process",
        previous["process_id"].as_u64() != Some(std::process::id() as u64),
        "different OS process; references loaded only from durable journal",
    )?;
    report.check(
        "source-files-not-required",
        !Path::new(".local/small.bin").exists() && !Path::new(".local/multipart.bin").exists(),
        "both upload source files removed before this process",
    )?;
    let mut recovered = 0;
    for index in 0..refs.objects.len() {
        let object = &refs.objects[index];
        match object.state.as_str() {
            "verified" | "unknown" => {
                verify(s3, object).on_heap().await?;
                let was_unknown = object.state == "unknown";
                report.check(&format!("restart-read-object-{index}"), true,
                    format!("{} bytes; stable binding/key + HEAD metadata + streamed SHA256; prior state {}", object.size, object.state))?;
                if was_unknown {
                    refs.objects[index].state = "verified".into();
                    recovered += 1;
                    save_refs(refs)?;
                }
            }
            "receiving" | "failed" | "cancelled" => {
                report.check(
                    &format!("restart-nonready-object-{index}"),
                    invisible(s3, object).on_heap().await?,
                    format!("HEAD/GET 404; state {} retained", object.state),
                )?;
            }
            _ => anyhow::bail!("unrecognized persisted state"),
        }
    }
    if report.phase == "resume" {
        report.check(
            "unknown-recovered-only-after-verification",
            recovered == 2,
            format!("{recovered} ambiguous writes recovered by read-only validation; no re-upload"),
        )?;
        let mut mismatch = refs.objects[0].clone();
        mismatch.size += 1;
        report.check(
            "wrong-reference-metadata-rejected",
            verify(s3, &mismatch).on_heap().await.is_err(),
            "a mismatched expected length cannot be accepted",
        )?;
    }
    std::fs::write(
        format!("evidence/references-after-{}.json", report.phase),
        serde_json::to_vec_pretty(refs)?,
    )?;
    Ok(())
}

pub async fn run(phase: &str) -> Result<()> {
    let s3 = client(ENDPOINT)?;
    let mut report = Report::new(phase);
    match phase {
        "ready" => {
            let mut observed = Vec::new();
            for _ in 0..30 {
                let response = s3.head_bucket().bucket(BUCKET).send().on_heap().await;
                let status = match response {
                    Ok(_) => 200,
                    Err(error) => error
                        .raw_response()
                        .map(|r| r.status().as_u16())
                        .unwrap_or(0),
                };
                observed.push(status);
                if status == 200 || status == 404 {
                    report.check(
                        "signed-s3-readiness",
                        true,
                        format!("signed HEAD bucket statuses {observed:?}"),
                    )?;
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            report.check(
                "signed-s3-readiness",
                false,
                format!("no signed S3 readiness in 30 attempts: {observed:?}"),
            )?;
        }
        "ranges" => {
            let refs = initialize(&s3).await?;
            report.check(
                "file-stream-put-head-get",
                true,
                "131209 bytes; SHA256/type/operation metadata verified; Unicode key",
            )?;
            ranges_and_auth(&s3, &refs.objects[0], &mut report).await?;
        }
        "multipart" => {
            let mut refs: References = serde_json::from_slice(&std::fs::read(REF_PATH)?)?;
            multipart(&s3, &mut refs, &mut report).await?;
        }
        "failures" => {
            let mut refs: References = serde_json::from_slice(&std::fs::read(REF_PATH)?)?;
            failures(&s3, &mut refs, &mut report).on_heap().await?;
        }
        "resume" | "verify" => {
            let mut refs: References = serde_json::from_slice(&std::fs::read(REF_PATH)?)?;
            resume(&s3, &mut refs, &mut report).await?;
        }
        _ => anyhow::bail!("unsupported validation phase"),
    }
    Ok(())
}
