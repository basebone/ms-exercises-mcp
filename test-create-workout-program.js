const { StreamableHTTPMCPServer } = require('./mcp-streamable-handler');

async function testCreateWorkoutProgram() {
  console.log('🧪 Testing create_workout_program MCP tool...\n');
  
  const server = new StreamableHTTPMCPServer();
  
  // Test data based on the reference files structure
  const testData = {
    program: {
      title: "Test Beginner Program",
      summary: "A test program for beginners",
      description: "This is a comprehensive test program designed for beginners to get started with fitness.",
      creator: "test-creator-id-123",
      categories: ["test-category-1", "test-category-2"],
      is_premium: false,
      content_metadata: {
        duration_weeks: "4",
        frequency: "3",
        difficulty: "easy",
        workout_type: "full_body"
      }
    },
    workouts: [
      {
        title: "Test Full Body Workout A",
        summary: "First test workout focusing on full body",
        description: "A balanced workout combining cardio and strength exercises",
        creator: "test-creator-id-123",
        categories: ["test-category-1"],
        is_premium: false,
        content_metadata: {
          difficulty: "easy",
          calories_burned: "250",
          location: "home",
          workout_type: "full_body",
          total_duration: 1800, // 30 minutes
          exercise_count: 8
        },
        sections: [
          {
            label: "Test Workout Section A",
            position: 1,
            items: [
              {
                _id: "test-exercise-1",
                position: 1,
                easy: 45,
                medium: 60,
                hard: 75
              },
              {
                _id: "test-exercise-2",
                position: 2,
                easy: 30,
                medium: 45,
                hard: 60
              }
            ],
            rest: "15",
            reps: "1"
          }
        ]
      },
      {
        title: "Test Full Body Workout B",
        summary: "Second test workout with different exercises",
        description: "A variation workout with different exercise combinations",
        creator: "test-creator-id-123",
        categories: ["test-category-2"],
        is_premium: false,
        content_metadata: {
          difficulty: "easy",
          calories_burned: "300",
          location: "home",
          workout_type: "full_body",
          total_duration: 2100, // 35 minutes
          exercise_count: 10
        },
        sections: [
          {
            label: "Test Workout Section B",
            position: 1,
            items: [
              {
                _id: "test-exercise-3",
                position: 1,
                easy: 60,
                medium: 75,
                hard: 90
              },
              {
                _id: "test-exercise-4",
                position: 2,
                easy: 45,
                medium: 60,
                hard: 75
              }
            ],
            rest: "20",
            reps: "1"
          }
        ]
      }
    ],
    program_schedule: [
      { day: 1, workout_index: 0 },
      { day: 2, workout_index: 1 },
      { day: 3, workout_index: 0 },
      { day: 4, workout_index: 1 },
      { day: 5, workout_index: 0 },
      { day: 6, workout_index: 1 }
    ]
  };

  try {
    console.log('📝 Test data prepared:');
    console.log(`- Program: "${testData.program.title}"`);
    console.log(`- Workouts: ${testData.workouts.length} workouts`);
    console.log(`- Schedule: ${testData.program_schedule.length} days\n`);

    console.log('🚀 Calling create_workout_program tool...');
    const startTime = Date.now();
    
    const result = await server.createWorkoutProgram(testData);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Tool completed in ${duration}ms\n`);

    // Parse the result
    const response = JSON.parse(result.content[0].text);
    
    if (response.success) {
      console.log('🎉 SUCCESS! Workout program created successfully:');
      console.log(`- Program ID: ${response.program.id}`);
      console.log(`- Program Title: ${response.program.title}`);
      console.log(`- Program Slug: ${response.program.slug}`);
      console.log(`- Created Workouts: ${response.workouts.length}`);
      
      console.log('\n📋 Created Workouts:');
      response.workouts.forEach((workout, index) => {
        console.log(`  ${index + 1}. ${workout.title} (ID: ${workout.id})`);
      });
      
      console.log('\n📅 Program Schedule:');
      response.schedule.forEach(item => {
        const workoutTitle = response.workouts.find(w => w.id === item.workout)?.title || 'Unknown';
        console.log(`  Day ${item.day}: ${workoutTitle} (${item.duration}s)`);
      });
      
      console.log(`\n✨ ${response.message}`);
      
    } else {
      console.log('❌ FAILED: Tool returned unsuccessful result');
      console.log(JSON.stringify(response, null, 2));
    }

  } catch (error) {
    console.error('❌ ERROR during test:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Test validation scenarios
async function testValidation() {
  console.log('\n🔍 Testing validation scenarios...\n');
  
  const server = new StreamableHTTPMCPServer();
  
  const testCases = [
    {
      name: 'Missing program field',
      data: { workouts: [], program_schedule: [] },
      expectedError: 'Missing required fields'
    },
    {
      name: 'Empty workouts array',
      data: { 
        program: { title: 'Test', summary: 'Test', description: 'Test', creator: 'test' },
        workouts: [],
        program_schedule: []
      },
      expectedError: 'At least one workout is required'
    },
    {
      name: 'Invalid workout index in schedule',
      data: {
        program: { title: 'Test', summary: 'Test', description: 'Test', creator: 'test' },
        workouts: [{ title: 'Test', summary: 'Test', description: 'Test', creator: 'test', sections: [] }],
        program_schedule: [{ day: 1, workout_index: 5 }]
      },
      expectedError: 'Invalid workout_index'
    }
  ];

  for (const testCase of testCases) {
    try {
      console.log(`Testing: ${testCase.name}`);
      await server.createWorkoutProgram(testCase.data);
      console.log('❌ Expected error but got success');
    } catch (error) {
      if (error.message.includes(testCase.expectedError)) {
        console.log('✅ Validation working correctly');
      } else {
        console.log(`❌ Unexpected error: ${error.message}`);
      }
    }
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Starting MCP create_workout_program Tool Tests\n');
  console.log('=' .repeat(60));
  
  try {
    await testCreateWorkoutProgram();
    await testValidation();
    
    console.log('\n' + '='.repeat(60));
    console.log('🏁 All tests completed!');
    
  } catch (error) {
    console.error('💥 Test suite failed:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = { testCreateWorkoutProgram, testValidation };
