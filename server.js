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

function normalizeBrokerSignature(node) {
  if (!node || typeof node !== 'object') {
    return '';
  }

  return JSON.stringify({
    broker: String(node.broker || '').trim(),
    port: String(node.port || ''),
    protocol: String(node.protocol || '').trim(),
    tls: Boolean(node.tls),
    clientid: String(node.clientid || '').trim()
  });
}

function fixDuplicateMqttBrokers(originalNodes, migrationResult) {
  const originalBrokers = (originalNodes || []).filter(node => node && node.type === 'mqtt-broker');
  const migratedNodes = getMigrationNodes(migrationResult);

  if (!originalBrokers.length || !migratedNodes.length) {
    return migrationResult;
  }

  const brokerIdMap = new Map();
  const originalSignatures = new Map();

  for (const originalBroker of originalBrokers) {
    originalSignatures.set(normalizeBrokerSignature(originalBroker), originalBroker.id);
  }

  const generatedBrokers = migratedNodes.filter(node => node && node.type === 'mqtt-broker');

  for (const generatedBroker of generatedBrokers) {
    const sig = normalizeBrokerSignature(generatedBroker);
    const matchingOriginalId = originalSignatures.get(sig);

    if (matchingOriginalId) {
      brokerIdMap.set(generatedBroker.id, matchingOriginalId);
      continue;
    }

    // If there is only one original broker in the flow, assume any matching generated broker
    // should point to that canonical config node. This preserves credentials and keeps Node-RED from
    // showing a duplicate MQTT server entry.
    if (originalBrokers.length === 1) {
      brokerIdMap.set(generatedBroker.id, originalBrokers[0].id);
    }
  }

  const rewrittenNodes = migratedNodes.map(node => {
    if (!node || typeof node !== 'object') {
      return node;
    }

    const nextNode = { ...node };

    if (
      (nextNode.type === 'mqtt in' || nextNode.type === 'mqtt out') &&
      nextNode.broker &&
      brokerIdMap.has(nextNode.broker)
    ) {
      nextNode.broker = brokerIdMap.get(nextNode.broker);
    }

    return nextNode;
  });

  const filteredNodes = rewrittenNodes.filter(node => {
    if (!node || typeof node !== 'object') {
      return true;
    }

    if (node.type !== 'mqtt-broker') {
      return true;
    }

    return !brokerIdMap.has(node.id);
  });

  const canonicalBrokerId = originalBrokers.length === 1 ? originalBrokers[0].id : null;
  if (canonicalBrokerId && !filteredNodes.some(node => node && node.id === canonicalBrokerId)) {
    filteredNodes.unshift({ ...originalBrokers[0] });
  }

  if (Array.isArray(migrationResult)) {
    return filteredNodes;
  }

  if (migrationResult && typeof migrationResult === 'object') {
    return {
      ...migrationResult,
      nodes: filteredNodes
    };
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
