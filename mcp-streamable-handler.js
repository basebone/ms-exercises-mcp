const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { ContentItems } = require('@baseplay/models');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

class StreamableHTTPMCPServer {
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

    this.sessions = new Map(); // Track active sessions
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
          },
          {
            name: 'create_workout_program',
            description: 'Create a workout program with multiple workouts in the database',
            inputSchema: {
              type: 'object',
              properties: {
                program: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Program title' },
                    summary: { type: 'string', description: 'Program summary' },
                    description: { type: 'string', description: 'Program description' },
                    slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                    categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                    creator: { type: 'string', description: 'Creator user ID' },
                    is_premium: { type: 'boolean', description: 'Whether the program is premium', default: false },
                    content_metadata: {
                      type: 'object',
                      properties: {
                        duration_weeks: { type: 'string', description: 'Program duration in weeks' },
                        frequency: { type: 'string', description: 'Workouts per week' },
                        difficulty: { type: 'string', description: 'Program difficulty level' },
                        workout_type: { type: 'string', description: 'Type of workout program' }
                      }
                    }
                  },
                  required: ['title', 'summary', 'description', 'creator']
                },
                workouts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: 'Workout title' },
                      summary: { type: 'string', description: 'Workout summary' },
                      description: { type: 'string', description: 'Workout description' },
                      slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                      categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                      creator: { type: 'string', description: 'Creator user ID' },
                      is_premium: { type: 'boolean', description: 'Whether the workout is premium', default: false },
                      content_metadata: {
                        type: 'object',
                        properties: {
                          difficulty: { type: 'string', description: 'Workout difficulty level' },
                          calories_burned: { type: 'string', description: 'Estimated calories burned' },
                          location: { type: 'string', description: 'Workout location (e.g., home, gym)' },
                          workout_type: { type: 'string', description: 'Type of workout' },
                          total_duration: { type: 'number', description: 'Total workout duration in seconds' },
                          exercise_count: { type: 'number', description: 'Number of exercises in workout' }
                        }
                      },
                      sections: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            label: { type: 'string', description: 'Section label' },
                            position: { type: 'number', description: 'Section position' },
                            items: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  _id: { type: 'string', description: 'Exercise ID' },
                                  position: { type: 'number', description: 'Exercise position' },
                                  easy: { type: 'number', description: 'Duration for easy difficulty' },
                                  medium: { type: 'number', description: 'Duration for medium difficulty' },
                                  hard: { type: 'number', description: 'Duration for hard difficulty' }
                                },
                                required: ['_id', 'position', 'easy', 'medium', 'hard']
                              }
                            },
                            rest: { type: 'string', description: 'Rest time between exercises' },
                            reps: { type: 'string', description: 'Number of repetitions' }
                          },
                          required: ['label', 'position', 'items']
                        }
                      }
                    },
                    required: ['title', 'summary', 'description', 'creator', 'sections']
                  },
                  description: 'Array of workouts to create'
                },
                program_schedule: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      day: { type: 'number', description: 'Day number in the program' },
                      workout_index: { type: 'number', description: 'Index of the workout in the workouts array' }
                    },
                    required: ['day', 'workout_index']
                  },
                  description: 'Schedule mapping days to workout indices'
                }
              },
              required: ['program', 'workouts', 'program_schedule']
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
          case 'create_workout_program':
            return await this.createWorkoutProgram(args);
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

  validateOrigin(origin) {
    // Security: Validate Origin header to prevent DNS rebinding attacks
    // Allow requests without Origin header (common for MCP clients, CLI tools, etc.)
    if (!origin) {
      console.log('No Origin header provided - allowing for MCP client compatibility');
      return true;
    }
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return true;
    }
    
    // Add your allowed origins here
    const allowedOrigins = [
      'https://your-domain.com',
      'https://claude.ai',
      // Add other trusted origins
    ];
    
    return allowedOrigins.includes(origin);
  }

  async ensureDbConnection() {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/main_store';
      await mongoose.connect(mongoUri);
    }
  }

  async getExercises(args = {}) {
    console.log('getExercises called with args:', args);
    const { limit = 10, skip = 0, category, search } = args;
    
    // Build aggregation pipeline
    const pipeline = [];
    
    // Stage 1: Match exercises with content_metadata
    const matchStage = {
      $match: {
        item_type: 'exercise',
        content_metadata: { $exists: true, $ne: null }
      }
    };
    
    // Add category filter if specified
    if (category) {
      matchStage.$match.categories = category;
    }
    
    // Add search filter if specified (search in English locale)
    if (search) {
      matchStage.$match.$or = [
        { 'locale.title': { $regex: search, $options: 'i' } },
        { 'locale.description': { $regex: search, $options: 'i' } }
      ];
    }
    
    pipeline.push(matchStage);
    
    // Stage 2: Add field to extract English locale data
    pipeline.push({
      $addFields: {
        englishLocale: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$locale',
                cond: { $eq: ['$$this.language_iso', 'en'] }
              }
            },
            0
          ]
        }
      }
    });
    
    // Stage 3: Project only the required fields
    pipeline.push({
      $project: {
        _id: 1,
        slug: 1,
        title: '$englishLocale.title',
        description: '$englishLocale.description',
        media: 1,
        content_metadata: 1,
        published_at: 1,
        categories: 1
      }
    });
    
    // Stage 4: Sort by published_at descending
    pipeline.push({
      $sort: { published_at: -1 }
    });
    
    // Stage 5: Skip and limit for pagination
    if (skip > 0) {
      pipeline.push({ $skip: skip });
    }
    
    pipeline.push({ $limit: limit });

    console.log('MongoDB aggregation pipeline:', JSON.stringify(pipeline, null, 2));
    console.log('Query options - limit:', limit, 'skip:', skip);

    try {
      console.log('Executing MongoDB aggregation...');
      const startTime = Date.now();
      
      const exercises = await ContentItems.aggregate(pipeline);
      
      const queryTime = Date.now() - startTime;
      console.log(`MongoDB aggregation completed in ${queryTime}ms, found ${exercises.length} exercises`);
      
      if (exercises.length === 0) {
        console.log('No exercises found - this might indicate a database connection or data issue');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              exercises: exercises.map(exercise => ({
                id: exercise._id,
                slug: exercise.slug,
                title: exercise.title || 'Untitled Exercise',
                description: exercise.description,
                media: exercise.media,
                content_metadata: exercise.content_metadata,
                published_at: exercise.published_at,
                categories: exercise.categories
              })),
              total: exercises.length,
              limit,
              skip
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in getExercises:', error);
      throw new Error(`Failed to retrieve exercises: ${error.message}`);
    }
  }

  async getExerciseById(args) {
    const { id } = args;
    
    if (!id) {
      throw new Error('Exercise ID is required');
    }

    const exercise = await ContentItems.findOne({
      _id: id,
      item_type: 'exercise',
      content_metadata: { $exists: true, $ne: null }
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
    console.log('searchExercises called with args:', args);
    const { query, categories, difficulty, duration } = args;
    
    // Build aggregation pipeline
    const pipeline = [];
    
    // Stage 1: Match exercises with content_metadata and search criteria
    const matchStage = {
      $match: {
        item_type: 'exercise',
        content_metadata: { $exists: true, $ne: null }
      }
    };

    // Add categories filter if specified
    if (categories && categories.length > 0) {
      matchStage.$match.categories = { $in: categories };
    }

    // Add difficulty filter if specified
    if (difficulty) {
      matchStage.$match['settings.difficulty'] = difficulty;
    }

    // Add duration filter if specified
    if (duration) {
      if (duration.min !== undefined || duration.max !== undefined) {
        matchStage.$match['settings.duration'] = {};
        if (duration.min !== undefined) {
          matchStage.$match['settings.duration'].$gte = duration.min;
        }
        if (duration.max !== undefined) {
          matchStage.$match['settings.duration'].$lte = duration.max;
        }
      }
    }

    pipeline.push(matchStage);
    
    // Stage 2: Add field to extract English locale data
    pipeline.push({
      $addFields: {
        englishLocale: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$locale',
                cond: { $eq: ['$$this.language_iso', 'en'] }
              }
            },
            0
          ]
        }
      }
    });

    // Stage 3: Add text search filter if query is specified (search in English locale)
    if (query) {
      pipeline.push({
        $match: {
          $or: [
            { 'englishLocale.title': { $regex: query, $options: 'i' } },
            { 'englishLocale.description': { $regex: query, $options: 'i' } },
            { 'englishLocale.instructions': { $regex: query, $options: 'i' } }
          ]
        }
      });
    }
    
    // Stage 4: Project only the required fields
    pipeline.push({
      $project: {
        _id: 1,
        slug: 1,
        title: '$englishLocale.title',
        description: '$englishLocale.description',
        media: 1,
        content_metadata: 1,
        published_at: 1,
        categories: 1,
        difficulty: '$settings.difficulty',
        duration: '$settings.duration'
      }
    });
    
    // Stage 5: Sort by published_at descending
    pipeline.push({
      $sort: { published_at: -1 }
    });

    console.log('searchExercises - MongoDB aggregation pipeline:', JSON.stringify(pipeline, null, 2));

    try {
      console.log('searchExercises - executing aggregation...');
      const startTime = Date.now();
      
      const exercises = await ContentItems.aggregate(pipeline);
      
      const queryTime = Date.now() - startTime;
      console.log(`searchExercises - aggregation completed in ${queryTime}ms, found ${exercises.length} exercises`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              exercises: exercises.map(exercise => ({
                id: exercise._id,
                slug: exercise.slug,
                title: exercise.title || 'Untitled Exercise',
                description: exercise.description,
                media: exercise.media,
                content_metadata: exercise.content_metadata,
                categories: exercise.categories,
                difficulty: exercise.difficulty,
                duration: exercise.duration,
                published_at: exercise.published_at
              })),
              total: exercises.length,
              searchQuery: args
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in searchExercises:', error);
      throw new Error(`Failed to search exercises: ${error.message}`);
    }
  }

  async getAllExercisesResource() {
    // Build aggregation pipeline for English locale filtering
    const pipeline = [
      // Stage 1: Match exercises with content_metadata
      {
        $match: {
          item_type: 'exercise',
          content_metadata: { $exists: true, $ne: null }
        }
      },
      
      // Stage 2: Add field to extract English locale data
      {
        $addFields: {
          englishLocale: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$locale',
                  cond: { $eq: ['$$this.language_iso', 'en'] }
                }
              },
              0
            ]
          }
        }
      },
      
      // Stage 3: Project only the required fields
      {
        $project: {
          _id: 1,
          slug: 1,
          title: '$englishLocale.title',
          description: '$englishLocale.description',
          media: 1,
          content_metadata: 1
        }
      }
    ];

    console.log('getAllExercisesResource - executing aggregation pipeline');
    const exercises = await ContentItems.aggregate(pipeline);
    console.log(`getAllExercisesResource - found ${exercises.length} exercises`);

    return {
      contents: [
        {
          uri: 'exercise://exercises',
          mimeType: 'application/json',
          text: JSON.stringify({
            exercises: exercises.map(exercise => ({
              id: exercise._id,
              slug: exercise.slug,
              title: exercise.title || 'Untitled Exercise',
              description: exercise.description,
              media: exercise.media,
              content_metadata: exercise.content_metadata
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
      content_metadata: { $exists: true, $ne: null }
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
          content_metadata: { $exists: true, $ne: null }
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
      content_metadata: { $exists: true, $ne: null }
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

  // Helper function to generate slug from title
  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim('-'); // Remove leading/trailing hyphens
  }

  // Helper function to create locale array
  createLocaleArray(title, summary, description, language = 'en') {
    return [{
      language_iso: language,
      title,
      summary,
      description,
      seo_title: null,
      seo_summary: null,
      seo_description: null,
      specify_seo_values: false
    }];
  }

  // Helper function to create default content item structure
  createDefaultContentItem(type) {
    const now = new Date();
    return {
      _id: uuidv4(),
      item_type: type,
      content_type: type,
      media: [],
      content: {
        src: null,
        extension: null,
        text: null,
        quality: null,
        size: null,
        size_unit: null
      },
      settings: {
        is_exclusive: false,
        is_premium: false,
        allowed_domains: [],
        excluded_domains: [],
        excluded_countries_iso: [],
        excluded_network_endpoints: [],
        age_rating: 'PG'
      },
      social_stats: {
        likes: 0,
        comments: 0,
        views: 0,
        rating: 0
      },
      top_comments: [{
        id: null,
        user_id: null,
        commentor_name: null,
        comment: null,
        parent_id: null,
        ancestor_ids: [],
        created_at: null
      }],
      collections: [],
      is_indexed: true,
      locks: {
        is_locked_for_editing: false,
        current_editor: null,
        is_locked_for_moderation_process: false,
        is_locked_for_backend_process: false,
        current_backend_process: null
      },
      internal_meta: {
        rating: 5,
        tags: []
      },
      language: 'en',
      published_at: now,
      collection_type: type,
      is_featured: false,
      is_spotlight: false,
      contents: [],
      created_at: now,
      updated_at: now,
      __v: 0,
      curation_scores: {
        usage: 0,
        recent_usage: 0,
        os: { android: 0, ios: 0, windows: 0, mac: 0 },
        featured: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        trending: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        spotlight: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        topten: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 },
        topics: { baseplay_theme_base: 0, baseplay_theme_one: 0, baseplay_theme_two: 0, baseplay_theme_three: 0, baseplay_theme_four: 0 }
      }
    };
  }

  async createWorkoutProgram(args) {
    console.log('createWorkoutProgram called with args:', JSON.stringify(args, null, 2));
    
    const { program, workouts, program_schedule } = args;
    
    // Validate required fields
    if (!program || !workouts || !program_schedule) {
      throw new Error('Missing required fields: program, workouts, and program_schedule are required');
    }
    
    if (!Array.isArray(workouts) || workouts.length === 0) {
      throw new Error('At least one workout is required');
    }
    
    if (!Array.isArray(program_schedule) || program_schedule.length === 0) {
      throw new Error('Program schedule is required');
    }
    
    // Validate program schedule references
    for (const scheduleItem of program_schedule) {
      if (scheduleItem.workout_index >= workouts.length || scheduleItem.workout_index < 0) {
        throw new Error(`Invalid workout_index ${scheduleItem.workout_index} in program_schedule. Must be between 0 and ${workouts.length - 1}`);
      }
    }
    
    try {
      console.log('Starting workout program creation...');
      
      // Step 1: Create all workouts first
      const createdWorkouts = [];
      
      for (let i = 0; i < workouts.length; i++) {
        const workout = workouts[i];
        console.log(`Creating workout ${i + 1}/${workouts.length}: ${workout.title}`);
        
        // Create workout document
        const workoutDoc = this.createDefaultContentItem('workouts');
        
        // Set workout-specific fields
        workoutDoc.slug = workout.slug || this.generateSlug(workout.title);
        workoutDoc.locale = this.createLocaleArray(workout.title, workout.summary, workout.description);
        workoutDoc.creator = workout.creator;
        workoutDoc.categories = workout.categories || [];
        workoutDoc.settings.is_premium = workout.is_premium || false;
        workoutDoc.content_metadata = workout.content_metadata || {};
        workoutDoc.sections = workout.sections || [];
        
        // Calculate total duration from sections if not provided
        if (!workoutDoc.content_metadata.total_duration && workout.sections) {
          let totalDuration = 0;
          let exerciseCount = 0;
          
          for (const section of workout.sections) {
            if (section.items) {
              for (const item of section.items) {
                // Use medium difficulty as default for duration calculation
                totalDuration += item.medium || item.easy || item.hard || 0;
                exerciseCount++;
              }
            }
          }
          
          workoutDoc.content_metadata.total_duration = totalDuration;
          workoutDoc.content_metadata.exercise_count = exerciseCount;
        }
        
        // Save workout to database
        const savedWorkout = await ContentItems.create(workoutDoc);
        createdWorkouts.push(savedWorkout);
        console.log(`Workout created with ID: ${savedWorkout._id}`);
      }
      
      // Step 2: Create the program with references to the created workouts
      console.log('Creating workout program...');
      
      const programDoc = this.createDefaultContentItem('workout-program');
      
      // Set program-specific fields
      programDoc.slug = program.slug || this.generateSlug(program.title);
      programDoc.locale = this.createLocaleArray(program.title, program.summary, program.description);
      programDoc.creator = program.creator;
      programDoc.categories = program.categories || [];
      programDoc.settings.is_premium = program.is_premium || false;
      programDoc.content_metadata = program.content_metadata || {};
      
      // Create sections array mapping days to workout IDs
      programDoc.sections = program_schedule.map(scheduleItem => {
        const workout = createdWorkouts[scheduleItem.workout_index];
        return {
          day: scheduleItem.day,
          duration: workout.content_metadata?.total_duration || 0,
          workout: workout._id
        };
      });
      
      // Save program to database
      const savedProgram = await ContentItems.create(programDoc);
      console.log(`Program created with ID: ${savedProgram._id}`);
      
      // Return success response
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              program: {
                id: savedProgram._id,
                title: program.title,
                slug: savedProgram.slug,
                created_at: savedProgram.created_at
              },
              workouts: createdWorkouts.map((workout, index) => ({
                id: workout._id,
                title: workouts[index].title,
                slug: workout.slug,
                created_at: workout.created_at
              })),
              schedule: programDoc.sections,
              message: `Successfully created workout program '${program.title}' with ${createdWorkouts.length} workouts`
            }, null, 2)
          }
        ]
      };
      
    } catch (error) {
      console.error('Error in createWorkoutProgram:', error);
      throw new Error(`Failed to create workout program: ${error.message}`);
    }
  }

  // Create SSE stream response
  createSSEResponse(sessionId) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Session-ID': sessionId
      },
      body: '', // Will be populated with SSE data
      isBase64Encoded: false
    };
  }

  // Format message as SSE event
  formatSSEMessage(data, event = 'message', id = null) {
    let message = '';
    if (id) message += `id: ${id}\n`;
    if (event) message += `event: ${event}\n`;
    message += `data: ${JSON.stringify(data)}\n\n`;
    return message;
  }

  // Handle tool calls directly
  async handleToolCall(params) {
    const { name, arguments: args } = params;

    try {
      await this.ensureDbConnection();

      switch (name) {
        case 'get_exercises':
          return await this.getExercises(args);
        case 'get_exercise_by_id':
          return await this.getExerciseById(args);
        case 'search_exercises':
          return await this.searchExercises(args);
        case 'create_workout_program':
          return await this.createWorkoutProgram(args);
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
  }

  // Handle resource reads directly
  async handleResourceRead(params) {
    const { uri } = params;

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
  }
}

// Streamable HTTP POST handler - for sending messages to server
exports.mcpPost = async (event) => {
  console.log('MCP POST Handler called with:', {
    method: event.httpMethod,
    path: event.path,
    headers: event.headers,
    body: event.body?.substring(0, 200) + '...'
  });

  const server = new StreamableHTTPMCPServer();
  
  try {
    // Validate Origin header for security
    const origin = event.headers?.origin || event.headers?.Origin;
    console.log('Origin validation:', { origin, isValid: server.validateOrigin(origin) });
    
    if (!server.validateOrigin(origin)) {
      console.log('Origin validation failed');
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Invalid origin' })
      };
    }

    // Parse the JSON-RPC message
    const mcpMessage = JSON.parse(event.body || '{}');
    console.log('Parsed MCP message:', mcpMessage);
    
    // Check Accept header
    const accept = event.headers?.accept || event.headers?.Accept || '';
    const supportsSSE = accept.includes('text/event-stream');
    const supportsJSON = accept.includes('application/json');

    console.log('Accept header analysis:', { accept, supportsSSE, supportsJSON });

    if (!supportsSSE && !supportsJSON) {
      console.log('Invalid Accept header');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Must accept application/json or text/event-stream' })
      };
    }

    // Handle different message types
    if (mcpMessage.method) {
      console.log('Processing JSON-RPC request:', mcpMessage.method);
      
      // Handle the request directly instead of using server.request
      let response;
      
      switch (mcpMessage.method) {
        case 'initialize':
          console.log('Handling initialize request');
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                logging: {}
              },
              serverInfo: {
                name: 'ms-exercise-mcp',
                version: '1.0.0'
              }
            }
          };
          break;
          
        case 'tools/list':
          console.log('Handling tools/list request');
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: {
              tools: [
                {
                  name: 'get_exercises',
                  description: 'Retrieve exercises from the database with optional filtering',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      limit: { type: 'number', description: 'Maximum number of exercises to return (default: 10)', default: 10 },
                      skip: { type: 'number', description: 'Number of exercises to skip for pagination (default: 0)', default: 0 },
                      category: { type: 'string', description: 'Filter by exercise category' },
                      search: { type: 'string', description: 'Search exercises by title or content' }
                    }
                  }
                },
                {
                  name: 'get_exercise_by_id',
                  description: 'Retrieve a specific exercise by its ID',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: 'The exercise ID to retrieve', required: true }
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
                      query: { type: 'string', description: 'Search query for exercise content' },
                      categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs to filter by' },
                      difficulty: { type: 'string', description: 'Filter by difficulty level' },
                      duration: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } }, description: 'Filter by exercise duration range' }
                    }
                  }
                },
                {
                  name: 'create_workout_program',
                  description: 'Create a workout program with multiple workouts in the database',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      program: {
                        type: 'object',
                        properties: {
                          title: { type: 'string', description: 'Program title' },
                          summary: { type: 'string', description: 'Program summary' },
                          description: { type: 'string', description: 'Program description' },
                          slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                          categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                          creator: { type: 'string', description: 'Creator user ID' },
                          is_premium: { type: 'boolean', description: 'Whether the program is premium', default: false },
                          content_metadata: {
                            type: 'object',
                            properties: {
                              duration_weeks: { type: 'string', description: 'Program duration in weeks' },
                              frequency: { type: 'string', description: 'Workouts per week' },
                              difficulty: { type: 'string', description: 'Program difficulty level' },
                              workout_type: { type: 'string', description: 'Type of workout program' }
                            }
                          }
                        },
                        required: ['title', 'summary', 'description', 'creator']
                      },
                      workouts: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            title: { type: 'string', description: 'Workout title' },
                            summary: { type: 'string', description: 'Workout summary' },
                            description: { type: 'string', description: 'Workout description' },
                            slug: { type: 'string', description: 'URL-friendly slug (optional, will be generated if not provided)' },
                            categories: { type: 'array', items: { type: 'string' }, description: 'Array of category IDs' },
                            creator: { type: 'string', description: 'Creator user ID' },
                            is_premium: { type: 'boolean', description: 'Whether the workout is premium', default: false },
                            content_metadata: {
                              type: 'object',
                              properties: {
                                difficulty: { type: 'string', description: 'Workout difficulty level' },
                                calories_burned: { type: 'string', description: 'Estimated calories burned' },
                                location: { type: 'string', description: 'Workout location (e.g., home, gym)' },
                                workout_type: { type: 'string', description: 'Type of workout' },
                                total_duration: { type: 'number', description: 'Total workout duration in seconds' },
                                exercise_count: { type: 'number', description: 'Number of exercises in workout' }
                              }
                            },
                            sections: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  label: { type: 'string', description: 'Section label' },
                                  position: { type: 'number', description: 'Section position' },
                                  items: {
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        _id: { type: 'string', description: 'Exercise ID' },
                                        position: { type: 'number', description: 'Exercise position' },
                                        easy: { type: 'number', description: 'Duration for easy difficulty' },
                                        medium: { type: 'number', description: 'Duration for medium difficulty' },
                                        hard: { type: 'number', description: 'Duration for hard difficulty' }
                                      },
                                      required: ['_id', 'position', 'easy', 'medium', 'hard']
                                    }
                                  },
                                  rest: { type: 'string', description: 'Rest time between exercises' },
                                  reps: { type: 'string', description: 'Number of repetitions' }
                                },
                                required: ['label', 'position', 'items']
                              }
                            }
                          },
                          required: ['title', 'summary', 'description', 'creator', 'sections']
                        },
                        description: 'Array of workouts to create'
                      },
                      program_schedule: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            day: { type: 'number', description: 'Day number in the program' },
                            workout_index: { type: 'number', description: 'Index of the workout in the workouts array' }
                          },
                          required: ['day', 'workout_index']
                        },
                        description: 'Schedule mapping days to workout indices'
                      }
                    },
                    required: ['program', 'workouts', 'program_schedule']
                  }
                }
              ]
            }
          };
          break;
          
        case 'resources/list':
          console.log('Handling resources/list request');
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: {
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
            }
          };
          break;
          
        case 'tools/call':
          console.log('Handling tools/call request:', mcpMessage.params);
          try {
            console.log('About to call handleToolCall...');
            const toolResult = await server.handleToolCall(mcpMessage.params);
            console.log('handleToolCall completed, result:', toolResult ? 'success' : 'no result');
            response = {
              jsonrpc: '2.0',
              id: mcpMessage.id,
              result: toolResult
            };
            console.log('tools/call response prepared');
          } catch (error) {
            console.error('Error in tools/call:', error);
            response = {
              jsonrpc: '2.0',
              id: mcpMessage.id,
              error: {
                code: -32603,
                message: 'Internal error',
                data: error.message
              }
            };
          }
          break;
          
        case 'resources/read':
          console.log('Handling resources/read request:', mcpMessage.params);
          const resourceResult = await server.handleResourceRead(mcpMessage.params);
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            result: resourceResult
          };
          break;
          
        default:
          console.log('Unknown method:', mcpMessage.method);
          response = {
            jsonrpc: '2.0',
            id: mcpMessage.id,
            error: {
              code: -32601,
              message: 'Method not found',
              data: `Unknown method: ${mcpMessage.method}`
            }
          };
      }
      
      console.log('Generated response:', response);
      console.log('Response handling - supportsSSE:', supportsSSE, 'supportsJSON:', supportsJSON);
      
      // For MCP protocol methods, prefer JSON responses for better compatibility
      const preferJSON = ['initialize', 'tools/list', 'resources/list', 'tools/call', 'resources/read'].includes(mcpMessage.method);
      console.log('Method:', mcpMessage.method, 'preferJSON:', preferJSON);
      
      if (supportsJSON && (preferJSON || !supportsSSE)) {
        // Return JSON response
        console.log('Sending JSON response');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
          },
          body: JSON.stringify(response)
        };
      } else if (supportsSSE) {
        // Return SSE stream with the response
        console.log('Sending SSE response');
        const sessionId = Date.now().toString();
        const sseResponse = server.formatSSEMessage(response, 'response', mcpMessage.id);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'X-Session-ID': sessionId
          },
          body: sseResponse,
          isBase64Encoded: false
        };
      } else {
        // Fallback to JSON
        console.log('Fallback to JSON response');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
          },
          body: JSON.stringify(response)
        };
      }
    } else if (mcpMessage.result !== undefined || mcpMessage.error !== undefined) {
      // This is a JSON-RPC response or notification
      return {
        statusCode: 202, // Accepted
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: ''
      };
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON-RPC message' })
      };
    }
    
  } catch (error) {
    console.error('MCP POST Handler Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        },
        id: null
      })
    };
  }
};

// Streamable HTTP GET handler - for listening to server messages via SSE
exports.mcpGet = async (event) => {
  const server = new StreamableHTTPMCPServer();
  
  try {
    // Validate Origin header for security
    const origin = event.headers?.origin || event.headers?.Origin;
    if (!server.validateOrigin(origin)) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error: 'Invalid origin' })
      };
    }

    // Check Accept header
    const accept = event.headers?.accept || event.headers?.Accept || '';
    if (!accept.includes('text/event-stream')) {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Allow': 'POST'
        },
        body: JSON.stringify({ error: 'Method Not Allowed - must accept text/event-stream' })
      };
    }

    // Create SSE stream for server-initiated messages
    const sessionId = Date.now().toString();
    
    // For now, just return an empty SSE stream
    // In a full implementation, this would maintain persistent connections
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Session-ID': sessionId
      },
      body: server.formatSSEMessage({ type: 'connected', sessionId }, 'connected'),
      isBase64Encoded: false
    };
    
  } catch (error) {
    console.error('MCP GET Handler Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Handle OPTIONS requests for CORS
exports.mcpOptions = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: ''
  };
};

module.exports = { 
  StreamableHTTPMCPServer,
  mcpPost: exports.mcpPost,
  mcpGet: exports.mcpGet,
  mcpOptions: exports.mcpOptions
};
