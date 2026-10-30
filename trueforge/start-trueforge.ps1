# Start TrueForge locally with network policy disabled to allow connection to the local extension MCP server
$env:NETWORK_POLICY_ENABLED = "false"
$env:PORT = "8790"
Write-Host "Starting TrueForge local harness on port 8790 with NETWORK_POLICY_ENABLED=false..." -ForegroundColor Green
npx @truefoundry/trueforge@latest --port 8790
