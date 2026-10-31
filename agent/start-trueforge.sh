#!/usr/bin/env bash
# Start TrueForge locally with network policy disabled to allow connection to the local extension MCP server
export NETWORK_POLICY_ENABLED="false"
export PORT="8790"
echo "Starting TrueForge local harness on port 8790 with NETWORK_POLICY_ENABLED=false..."
npx @truefoundry/trueforge@latest --port 8790

