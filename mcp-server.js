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
        tools: [
          {
            name: 'get_exercises',
            description: 'Retrieve exercises from the database with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of exercises to return (default: 10)',
                  default: 10
                },
                skip: {
                  type: 'number',
                  description: 'Number of exercises to skip for pagination (default: 0)',
                  default: 0
                },
                category: {
                  type: 'string',
                  description: 'Filter by exercise category'
                },
                search: {
                  type: 'string',
                  description: 'Search exercises by title or content'
                }
              }
            }
          },
          {
            name: 'get_exercise_by_id',
            description: 'Retrieve a specific exercise by its ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The exercise ID to retrieve',
                  required: true
                }
              },
              required: ['id']
            }
          },
          {
            name: 'search_exercises',
            description: 'Search exercises with advanced filtering options',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for exercise content'
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of category IDs to filter by'
                },
                difficulty: {
                  type: 'string',
                  description: 'Filter by difficulty level'
                },
                duration: {
                  type: 'object',
                  properties: {
                    min: { type: 'number' },
                    max: { type: 'number' }
                  },
                  description: 'Filter by exercise duration range'
                }
              }
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureDbConnection();

        switch (name) {
          case 'get_exercises':
            return await this.getExercises(args);
          case 'get_exercise_by_id':
            return await this.getExerciseById(args);
          case 'search_exercises':
            return await this.searchExercises(args);
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
          },
          {
            uri: 'exercise://categories',
            name: 'Exercise Categories',
            description: 'List of all exercise categories',
            mimeType: 'application/json'
          },
          {
            uri: 'exercise://stats',
            name: 'Exercise Statistics',
            description: 'Statistics about exercises in the database',
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
          case 'exercise://categories':
            return await this.getCategoriesResource();
          case 'exercise://stats':
            return await this.getStatsResource();
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

  async getExercises(args = {}) {
    const { limit = 10, skip = 0, category, search } = args;
    
    const query = {
      item_type: 'exercise',
      published_at: { $ne: null }
    };

    if (category) {
      query.categories = category;
    }

    if (search) {
      query.$or = [
        { 'content.title': { $regex: search, $options: 'i' } },
        { 'content.description': { $regex: search, $options: 'i' } }
      ];
    }

    const exercises = await ContentItems.find(query)
      .limit(limit)
      .skip(skip)
      .sort({ published_at: -1 })
      .populate('categories')
      .lean();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            exercises: exercises.map(exercise => ({
              id: exercise._id,
              title: exercise.content?.title || 'Untitled Exercise',
              description: exercise.content?.description,
              categories: exercise.categories,
              published_at: exercise.published_at,
              content_type: exercise.content_type,
              media: exercise.media
            })),
            total: exercises.length,
            limit,
            skip
          }, null, 2)
        }
      ]
    };
  }

  async getExerciseById(args) {
    const { id } = args;
    
    if (!id) {
      throw new Error('Exercise ID is required');
    }

    const exercise = await ContentItems.findOne({
      _id: id,
      item_type: 'exercise',
      published_at: { $ne: null }
    })
    .populate('categories')
    .populate('creator')
    .lean();

    if (!exercise) {
      throw new Error('Exercise not found');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            exercise: {
              id: exercise._id,
              title: exercise.content?.title || 'Untitled Exercise',
              description: exercise.content?.description,
              content: exercise.content,
              categories: exercise.categories,
              creator: exercise.creator,
              published_at: exercise.published_at,
              content_type: exercise.content_type,
              media: exercise.media,
              settings: exercise.settings,
              sections: exercise.sections
            }
          }, null, 2)
        }
      ]
    };
  }

  async searchExercises(args = {}) {
    const { query, categories, difficulty, duration } = args;
    
    const searchQuery = {
      item_type: 'exercise',
      published_at: { $ne: null }
    };

    if (query) {
      searchQuery.$or = [
        { 'content.title': { $regex: query, $options: 'i' } },
        { 'content.description': { $regex: query, $options: 'i' } },
        { 'content.instructions': { $regex: query, $options: 'i' } }
      ];
    }

    if (categories && categories.length > 0) {
      searchQuery.categories = { $in: categories };
    }

    if (difficulty) {
      searchQuery['settings.difficulty'] = difficulty;
    }

    if (duration) {
      if (duration.min !== undefined || duration.max !== undefined) {
        searchQuery['settings.duration'] = {};
        if (duration.min !== undefined) {
          searchQuery['settings.duration'].$gte = duration.min;
        }
        if (duration.max !== undefined) {
          searchQuery['settings.duration'].$lte = duration.max;
        }
      }
    }

    const exercises = await ContentItems.find(searchQuery)
      .populate('categories')
      .sort({ published_at: -1 })
      .lean();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            exercises: exercises.map(exercise => ({
              id: exercise._id,
              title: exercise.content?.title || 'Untitled Exercise',
              description: exercise.content?.description,
              categories: exercise.categories,
              difficulty: exercise.settings?.difficulty,
              duration: exercise.settings?.duration,
              published_at: exercise.published_at
            })),
            total: exercises.length,
            searchQuery: args
          }, null, 2)
        }
      ]
    };
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

  async getCategoriesResource() {
    const categories = await ContentItems.distinct('categories', {
      item_type: 'exercise',
      published_at: { $ne: null }
    });

    return {
      contents: [
        {
          uri: 'exercise://categories',
          mimeType: 'application/json',
          text: JSON.stringify({
            categories,
            total: categories.length
          }, null, 2)
        }
      ]
    };
  }

  async getStatsResource() {
    const stats = await ContentItems.aggregate([
      {
        $match: {
          item_type: 'exercise',
          published_at: { $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avgDuration: { $avg: '$settings.duration' },
          categories: { $addToSet: '$categories' }
        }
      }
    ]);

    const categoryCount = await ContentItems.distinct('categories', {
      item_type: 'exercise',
      published_at: { $ne: null }
    });

    return {
      contents: [
        {
          uri: 'exercise://stats',
          mimeType: 'application/json',
          text: JSON.stringify({
            totalExercises: stats[0]?.total || 0,
            averageDuration: stats[0]?.avgDuration || 0,
            totalCategories: categoryCount.length,
            lastUpdated: new Date().toISOString()
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
