const express = require('express');
const path = require('path');
const MigrateDashboard = require('@flowfuse/node-red-dashboard-2-migration');

const app = express();
const port = process.env.PORT || 3000;

function getMigrationNodes(migrationResult) {
  if (Array.isArray(migrationResult)) {
    return migrationResult;
  }

  if (migrationResult && Array.isArray(migrationResult.nodes)) {
    return migrationResult.nodes;
  }

  return [];
}

function getBrokerSignature(node) {
  if (!node || typeof node !== 'object') {
    return '';
  }

  return JSON.stringify({
    type: node.type,
    name: node.name || '',
    broker: node.broker || '',
    port: node.port || '',
    clientid: node.clientid || '',
    usetls: node.usetls || false,
    compatmode: node.compatmode || false
  });
}

function fixDuplicateMqttBrokers(originalNodes, migrationResult) {
  // The migration library can generate fresh MQTT broker config ids while updating
  // every mqtt in/out node to point at those replacement ids. The original broker id
  // is the canonical value in a flow export, so retain it instead of letting the
  // conversion rewrite references to a generated config node id.
  const flowNodes = Array.isArray(originalNodes)
    ? originalNodes
    : (originalNodes && Array.isArray(originalNodes.nodes)) ? originalNodes.nodes : [];

  const migratedNodes = getMigrationNodes(migrationResult);
  const originalBrokers = flowNodes.filter(node => node && node.type === 'mqtt-broker');
  const migratedBrokers = migratedNodes.filter(node => node && node.type === 'mqtt-broker');

  const originalBrokerSignatureMap = new Map();
  for (const brokerNode of originalBrokers) {
    const signature = getBrokerSignature(brokerNode);
    if (signature) {
      originalBrokerSignatureMap.set(signature, brokerNode.id);
    }
  }

  const brokerIdMap = new Map();
  for (const brokerNode of migratedBrokers) {
    const signature = getBrokerSignature(brokerNode);
    const originalId = originalBrokerSignatureMap.get(signature);

    if (!originalId) {
      continue;
    }

    brokerIdMap.set(brokerNode.id, originalId);
    brokerNode.id = originalId;
  }

  for (const node of migratedNodes) {
    if (node && typeof node.broker === 'string' && brokerIdMap.has(node.broker)) {
      node.broker = brokerIdMap.get(node.broker);
    }
  }

  if (Array.isArray(migrationResult)) {
    return migratedNodes;
  }

  if (migrationResult && Array.isArray(migrationResult.nodes)) {
    migrationResult.nodes = migratedNodes;
    return migrationResult;
  }

  return migrationResult;
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Conversion endpoint
app.post('/api/convert', (req, res) => {
  try {
    const dashboardV1Json = req.body;
    
    if (!dashboardV1Json) {
      return res.status(400).json({ 
        error: 'No JSON data provided' 
      });
    }

    // Handle different input formats:
    // 1. Array of nodes (direct flow array)
    // 2. Object with 'nodes' property (Node-RED export format)
    let flowArray;
    if (Array.isArray(dashboardV1Json)) {
      flowArray = dashboardV1Json;
    } else if (dashboardV1Json.nodes && Array.isArray(dashboardV1Json.nodes)) {
      flowArray = dashboardV1Json.nodes;
    } else {
      return res.status(400).json({ 
        error: 'Invalid format. Expected an array of nodes or an object with a "nodes" property.' 
      });
    }

    // Migrate Dashboard v1 to v2
    const migrated = MigrateDashboard.migrate(flowArray);
    const dashboardV2Json = fixDuplicateMqttBrokers(flowArray, migrated);
    
    res.json({
      success: true,
      data: dashboardV2Json
    });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ 
      error: 'Error converting the JSON',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Open your browser and navigate to http://localhost:${port}`);
});
