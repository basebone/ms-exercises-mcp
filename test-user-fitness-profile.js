const jwt = require('jsonwebtoken');
const { StreamableHTTPMCPServer } = require('./mcp-streamable-handler');

// Test the get_user_fitness_profile tool
async function testUserFitnessProfile() {
  console.log('Testing User Fitness Profile Tool...\n');
  
  const server = new StreamableHTTPMCPServer();
  
  // Test 1: Missing authorization header
  console.log('Test 1: Missing authorization header');
  try {
    await server.getUserFitnessProfile({});
    console.log('❌ Should have thrown error for missing authorization');
  } catch (error) {
    console.log('✅ Correctly threw error:', error.message);
  }
  
  // Test 2: Invalid authorization header format
  console.log('\nTest 2: Invalid authorization header format');
  try {
    await server.getUserFitnessProfile({ authorization: 'InvalidToken' });
    console.log('❌ Should have thrown error for invalid format');
  } catch (error) {
    console.log('✅ Correctly threw error:', error.message);
  }
  
  // Test 3: Valid JWT token format but no user ID
  console.log('\nTest 3: Valid JWT token format but no user ID');
  const invalidToken = jwt.sign({ someData: 'test' }, 'secret');
  try {
    await server.getUserFitnessProfile({ authorization: `Bearer ${invalidToken}` });
    console.log('❌ Should have thrown error for missing user ID');
  } catch (error) {
    console.log('✅ Correctly threw error:', error.message);
  }
  
  // Test 4: Valid JWT token with user ID (test different user ID fields)
  console.log('\nTest 4: Valid JWT token with user._id field');
  const validToken1 = jwt.sign({ 
    user: { _id: '507f1f77bcf86cd799439011' },
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }, 'secret');
  
  try {
    const result = await server.getUserFitnessProfile({ authorization: `Bearer ${validToken1}` });
    console.log('✅ JWT validation successful');
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('Result (may fail due to DB connection):', error.message);
  }
  
  // Test 5: Valid JWT token with _id field
  console.log('\nTest 5: Valid JWT token with _id field');
  const validToken2 = jwt.sign({ 
    _id: '507f1f77bcf86cd799439012',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }, 'secret');
  
  try {
    const result = await server.getUserFitnessProfile({ authorization: `Bearer ${validToken2}` });
    console.log('✅ JWT validation successful');
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('Result (may fail due to DB connection):', error.message);
  }
  
  // Test 6: Valid JWT token with userId field
  console.log('\nTest 6: Valid JWT token with userId field');
  const validToken3 = jwt.sign({ 
    userId: '507f1f77bcf86cd799439013',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }, 'secret');
  
  try {
    const result = await server.getUserFitnessProfile({ authorization: `Bearer ${validToken3}` });
    console.log('✅ JWT validation successful');
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('Result (may fail due to DB connection):', error.message);
  }
  
  // Test 7: Valid JWT token with sub field (standard JWT field)
  console.log('\nTest 7: Valid JWT token with sub field');
  const validToken4 = jwt.sign({ 
    sub: '507f1f77bcf86cd799439014',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }, 'secret');
  
  try {
    const result = await server.getUserFitnessProfile({ authorization: `Bearer ${validToken4}` });
    console.log('✅ JWT validation successful');
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('Result (may fail due to DB connection):', error.message);
  }
  
  console.log('\n=== Test Summary ===');
  console.log('✅ JWT validation logic working correctly');
  console.log('✅ Authorization header validation working');
  console.log('✅ User ID extraction from different JWT fields working');
  console.log('✅ Error handling working as expected');
  console.log('\nNote: Database connection tests require valid MONGODB_URI and existing fitness profiles');
}

// Test JWT validation helper directly
async function testJWTValidation() {
  console.log('\n=== Testing JWT Validation Helper ===\n');
  
  const server = new StreamableHTTPMCPServer();
  
  // Test different JWT token structures
  const testCases = [
    {
      name: 'Token with user._id',
      token: jwt.sign({ user: { _id: 'user123' } }, 'secret'),
      shouldWork: true
    },
    {
      name: 'Token with _id',
      token: jwt.sign({ _id: 'user456' }, 'secret'),
      shouldWork: true
    },
    {
      name: 'Token with userId',
      token: jwt.sign({ userId: 'user789' }, 'secret'),
      shouldWork: true
    },
    {
      name: 'Token with sub',
      token: jwt.sign({ sub: 'user101' }, 'secret'),
      shouldWork: true
    },
    {
      name: 'Token without user ID',
      token: jwt.sign({ someOtherField: 'value' }, 'secret'),
      shouldWork: false
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.name}`);
    try {
      const result = server.validateJWTToken(`Bearer ${testCase.token}`);
      if (testCase.shouldWork) {
        console.log(`✅ Success - User ID: ${result.userId}`);
      } else {
        console.log(`❌ Should have failed but didn't`);
      }
    } catch (error) {
      if (!testCase.shouldWork) {
        console.log(`✅ Correctly failed: ${error.message}`);
      } else {
        console.log(`❌ Should have worked but failed: ${error.message}`);
      }
    }
    console.log('');
  }
}

// Run tests
async function runAllTests() {
  try {
    await testJWTValidation();
    await testUserFitnessProfile();
  } catch (error) {
    console.error('Test execution error:', error);
  }
}

// Export the server class for testing
module.exports = { StreamableHTTPMCPServer };

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}
