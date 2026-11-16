#!/usr/bin/env bash
# Start TrueForge locally with network policy disabled to allow connection to the local extension MCP server
export NETWORK_POLICY_ENABLED="false"
export PORT="8790"
echo "Starting TrueForge local harness on port 8790 with NETWORK_POLICY_ENABLED=false..."
npx -y @truefoundry/trueforge@0.183.1 --port 8790

