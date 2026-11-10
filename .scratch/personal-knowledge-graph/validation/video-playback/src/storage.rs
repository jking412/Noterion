use anyhow::{Context, Result, bail, ensure};
use aws_sdk_s3::{
    Client,
    config::{BehaviorVersion, Credentials, Region, retry::RetryConfig, timeout::TimeoutConfig},
    primitives::{ByteStream, Length},
    types::{CompletedMultipartUpload, CompletedPart},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::io::AsyncReadExt;

pub const BUCKET: &str = "issue-13-video";
pub const ENDPOINT: &str = "http://127.0.0.1:19300";
pub const SAMPLES: [(&str, &str, &str); 3] = [
    ("h264", "issue-13-h264-aac.mp4", "video/mp4"),
    ("webm", "issue-13-vp9-opus.webm", "video/webm"),
    ("ffv1", "issue-13-ffv1-pcm.mkv", "video/x-matroska"),
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Object {
    pub sample: String,
    pub connection_id: String,
    pub bucket: String,
    pub object_key: String,
    pub file_name: String,
    pub mime: String,
    pub size: u64,
    pub sha256: String,
}

pub fn client() -> Result<Client> {
    let access = std::env::var("ISSUE13_ACCESS_KEY").context("missing Issue13 access key")?;
    let secret = std::env::var("ISSUE13_SECRET_KEY").context("missing Issue13 secret key")?;
    Ok(Client::from_conf(
        aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(ENDPOINT)
            .region(Region::new("us-east-1"))
            .force_path_style(true)
            .http_client(
                aws_smithy_http_client::Builder::new()
                    .tls_provider(aws_smithy_http_client::tls::Provider::Rustls(
                        aws_smithy_http_client::tls::rustls_provider::CryptoMode::Ring,
                    ))
                    .build_https(),
            )
            .credentials_provider(Credentials::new(
                access,
                secret,
                None,
                None,
                "issue-13-local",
            ))
            .retry_config(RetryConfig::standard().with_max_attempts(1))
            .timeout_config(
                TimeoutConfig::builder()
                    .operation_timeout(Duration::from_secs(180))
                    .build(),
            )
            .build(),
    ))
}

pub async fn hash_reader(mut reader: impl tokio::io::AsyncRead + Unpin) -> Result<(u64, String)> {
    let mut buffer = [0u8; 65536];
    let mut digest = Sha256::new();
    let mut size = 0;
    loop {
        let n = reader
            .read(&mut buffer)
            .await
            .context("read stream for SHA256")?;
        if n == 0 {
            break;
        }
        size += n as u64;
        digest.update(&buffer[..n]);
    }
    Ok((size, format!("{:x}", digest.finalize())))
}

pub async fn upload(root: &Path, evidence: &Path) -> Result<()> {
    let s3 = client()?;
    let create = Box::pin(s3.create_bucket().bucket(BUCKET).send()).await;
    if let Err(error) = create {
        let code = error.as_service_error().and_then(|e| e.meta().code());
        if !matches!(
            code,
            Some("BucketAlreadyOwnedByYou" | "BucketAlreadyExists")
        ) {
            bail!(
                "create bucket failed: HTTP {:?}, code {:?}",
                error.raw_response().map(|r| r.status().as_u16()),
                code
            );
        }
    }
    let mut objects = Vec::new();
    for (sample, file_name, mime) in SAMPLES {
        let path = root.join(".local/samples").join(file_name);
        let (size, sha256) = hash_reader(
            tokio::fs::File::open(&path)
                .await
                .context("open generated sample")?,
        )
        .await?;
        if sample == "h264" {
            ensure!(
                (1_000_000_000..=2_147_483_648).contains(&size),
                "H264 sample must actually contain 1–2 GB"
            );
        }
        let object = Object {
            sample: sample.into(),
            connection_id: "issue-13-rustfs-local".into(),
            bucket: BUCKET.into(),
            object_key: format!("issue-13/{file_name}"),
            file_name: file_name.into(),
            mime: mime.into(),
            size,
            sha256,
        };
        let existing = Box::pin(
            s3.head_object()
                .bucket(BUCKET)
                .key(&object.object_key)
                .send(),
        )
        .await;
        let reuse = existing.as_ref().is_ok_and(|h| {
            h.content_length() == Some(size as i64)
                && h.metadata().and_then(|m| m.get("sha256")) == Some(&object.sha256)
        });
        if !reuse {
            let created = Box::pin(
                s3.create_multipart_upload()
                    .bucket(BUCKET)
                    .key(&object.object_key)
                    .content_type(mime)
                    .metadata("sha256", &object.sha256)
                    .metadata("issue", "13")
                    .send(),
            )
            .await
            .map_err(|_| anyhow::anyhow!("create multipart failed for {sample}"))?;
            let upload_id = created.upload_id().context("missing multipart ID")?;
            let mut parts = Vec::new();
            let mut offset = 0;
            while offset < size {
                let length = (8 * 1024 * 1024).min(size - offset);
                let body = ByteStream::read_from()
                    .path(&path)
                    .offset(offset)
                    .length(Length::Exact(length))
                    .build()
                    .await
                    .context("open multipart source range")?;
                let number = parts.len() as i32 + 1;
                let response = Box::pin(
                    s3.upload_part()
                        .bucket(BUCKET)
                        .key(&object.object_key)
                        .upload_id(upload_id)
                        .part_number(number)
                        .body(body)
                        .send(),
                )
                .await
                .map_err(|_| {
                    anyhow::anyhow!("upload multipart part {number} failed for {sample}")
                })?;
                parts.push(
                    CompletedPart::builder()
                        .part_number(number)
                        .e_tag(response.e_tag().context("missing part ETag")?)
                        .build(),
                );
                offset += length;
            }
            Box::pin(
                s3.complete_multipart_upload()
                    .bucket(BUCKET)
                    .key(&object.object_key)
                    .upload_id(upload_id)
                    .multipart_upload(
                        CompletedMultipartUpload::builder()
                            .set_parts(Some(parts))
                            .build(),
                    )
                    .send(),
            )
            .await
            .map_err(|_| anyhow::anyhow!("complete multipart failed for {sample}"))?;
        }
        let response = Box::pin(
            s3.get_object()
                .bucket(BUCKET)
                .key(&object.object_key)
                .send(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("verify object GET failed for {sample}"))?;
        let (actual_size, actual_sha) = hash_reader(response.body.into_async_read()).await?;
        ensure!(
            actual_size == size && actual_sha == object.sha256,
            "uploaded {sample} differs from independently hashed source"
        );
        println!("PASS {sample}: {size} bytes; streamed SHA256 verified; reused={reuse}");
        objects.push(object);
    }
    tokio::fs::create_dir_all(evidence).await?;
    tokio::fs::write(
        evidence.join("objects.json"),
        serde_json::to_vec_pretty(&objects)?,
    )
    .await?;
    Ok(())
}
