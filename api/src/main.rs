#[tokio::main]
async fn main() -> anyhow::Result<()> {
    gewt_api::run().await
}
