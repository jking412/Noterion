use anyhow::{Context, Result, ensure};
use aws_sdk_s3::{
    Client,
    config::{BehaviorVersion, Credentials, Region, retry::RetryConfig, timeout::TimeoutConfig},
    primitives::ByteStream,
};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
mod validation;

trait OnHeap: std::future::Future + Sized {
    fn on_heap(self) -> std::pin::Pin<Box<Self>> {
        Box::pin(self)
    }
}
impl<F: std::future::Future> OnHeap for F {}

const BUCKET: &str = "issue-10-compatibility";
const ENDPOINT: &str = "http://127.0.0.1:19100";

fn client(endpoint: &str) -> Result<Client> {
    let access = std::env::var("ISSUE10_ACCESS_KEY").context("missing Issue 10 access key")?;
    let secret = std::env::var("ISSUE10_SECRET_KEY").context("missing Issue 10 secret key")?;
    Ok(Client::from_conf(
        aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(endpoint)
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
                "issue-10-local",
            ))
            .retry_config(RetryConfig::standard().with_max_attempts(1))
            .timeout_config(
                TimeoutConfig::builder()
                    .operation_timeout(Duration::from_secs(30))
                    .build(),
            )
            .build(),
    ))
}

async fn put_file(client: &Client, path: &Path, key: &str) -> Result<()> {
    client
        .put_object()
        .bucket(BUCKET)
        .key(key)
        .content_type("application/octet-stream")
        .metadata("issue", "10")
        .body(ByteStream::from_path(path).await?)
        .send()
        .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let phase = std::env::args().nth(1).unwrap_or_else(|| "probe".into());
    if phase != "probe" {
        return validation::run(&phase).on_heap().await;
    }
    let s3 = client(ENDPOINT)?;
    s3.create_bucket().bucket(BUCKET).send().await?;
    tokio::fs::create_dir_all(".local").await?;
    let expected = b"Noterion issue-10 file persistence\n";
    tokio::fs::write(".local/probe.bin", expected).await?;
    put_file(&s3, Path::new(".local/probe.bin"), "issue-10/probe.bin").await?;
    let response = s3
        .get_object()
        .bucket(BUCKET)
        .key("issue-10/probe.bin")
        .send()
        .await?;
    let bytes = response.body.collect().await?.into_bytes();
    ensure!(
        Sha256::digest(&bytes) == Sha256::digest(expected),
        "stored bytes differ from source"
    );
    println!("PASS file upload makes identical bytes retrievable");
    Ok(())
}
