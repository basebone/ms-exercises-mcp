const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { ContentItems } = require('@baseplay/models');
const mongoose = require('mongoose');

class ExerciseMCPHandler {
  constructor() {
    this.server = new Server(
      {
        name: 'exercise-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: false
          },
          resources: {
            subscribe: false,
            listChanged: false
          }
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: []
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureDbConnection();

        switch (name) {
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'exercise://exercises',
            name: 'All Exercises',
            description: 'Complete list of all published exercises',
            mimeType: 'application/json'
          }
        ]
      };
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      try {
        await this.ensureDbConnection();

        switch (uri) {
          case 'exercise://exercises':
            return await this.getAllExercisesResource();
          default:
            throw new Error(`Unknown resource: ${uri}`);
        }
      } catch (error) {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async ensureDbConnection() {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/baseplay';
      await mongoose.connect(mongoUri);
    }
  }


  async getAllExercisesResource() {
    const exercises = await ContentItems.find({
      item_type: 'exercise',
      published_at: { $ne: null }
    })
    .populate('categories')
    .sort({ published_at: -1 })
    .lean();

    return {
      contents: [
        {
          uri: 'exercise://exercises',
          mimeType: 'application/json',
          text: JSON.stringify({
            exercises: exercises.map(exercise => ({
              id: exercise._id,
              title: exercise.content?.title || 'Untitled Exercise',
              description: exercise.content?.description,
              categories: exercise.categories,
              published_at: exercise.published_at,
              content_type: exercise.content_type
            })),
            total: exercises.length
          }, null, 2)
        }
      ]
    };
  }


  async handleRequest(mcpRequest) {
    try {
      const response = await this.server.request(mcpRequest);
      return response;
    } catch (error) {
      throw new Error(`MCP request failed: ${error.message}`);
    }
  }
}

// Serverless handler for HTTP requests
exports.mcpHandler = async (event) => {
  const handler = new ExerciseMCPHandler();
  
  try {
    // Parse the MCP request from the HTTP event
    const mcpRequest = JSON.parse(event.body || '{}');
    
    // Handle the MCP request
    const response = await handler.handleRequest(mcpRequest);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error('MCP Handler Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        type: 'InternalError'
      })
    };
  }
};

// Handle OPTIONS requests for CORS
exports.mcpOptions = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: ''
  };
};

module.exports = { ExerciseMCPHandler };
