# Start TrueForge locally with network policy disabled to allow connection to the local extension MCP server
$env:NETWORK_POLICY_ENABLED = "false"
$env:PORT = "8790"
Write-Host "Starting TrueForge local harness on port 8790 with NETWORK_POLICY_ENABLED=false..." -ForegroundColor Green
npx -y @truefoundry/trueforge@0.183.1 --port 8790

