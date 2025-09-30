const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { ContentItems } = require('@baseplay/models');
const mongoose = require('mongoose');

class ExerciseMCPServer {
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


  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Exercise MCP Server running on stdio');
  }
}

// Run the server if this file is executed directly
if (require.main === module) {
  const server = new ExerciseMCPServer();
  server.run().catch(console.error);
}

module.exports = ExerciseMCPServer;
