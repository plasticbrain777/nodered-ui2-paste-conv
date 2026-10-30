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

function fixDuplicateMqttBrokers(originalNodes, migrationResult) {
  // Preserve the broker references created by the migration library instead of
  // rewriting them to a different MQTT config node ID. The original broker id in
  // a Node-RED flow is the canonical value and should stay stable when the JSON is
  // exported back out.
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
