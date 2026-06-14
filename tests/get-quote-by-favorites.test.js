
const mockSend = jest.fn();
const mockDynamoDBClient = {
  send: mockSend
};

jest.doMock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({}))
}));

jest.doMock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => mockDynamoDBClient)
  },
  QueryCommand: jest.fn(),
  ScanCommand: jest.fn(),
  GetCommand: jest.fn()
}));

describe('get-quote-by-favorites', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';
    
    delete require.cache[require.resolve('../lambdas/get-quote-by-favorites/index.mjs')];
    
    return import('../lambdas/get-quote-by-favorites/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should scan all favorites when alias is missing and return 404 when none exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = {
      queryStringParameters: {}
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('No favorites found');
  });

  test('should return 404 when no favorites found for alias', async () => {
    mockSend.mockResolvedValueOnce({
      Items: []
    });

    const event = {
      queryStringParameters: { alias: 'testuser' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('No favorites found for alias: testuser');
  });

  test('should return random quote from user favorites', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }]
      })
      .mockResolvedValueOnce({
        Item: {
          quoteId: 'quote1',
          character: 'Arthur',
          text: 'Test favorite quote'
        }
      })
      .mockResolvedValueOnce({
        Count: 3
      });

    const event = {
      queryStringParameters: { alias: 'testuser' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('quoteId');
    expect(body).toHaveProperty('character');
    expect(body).toHaveProperty('likes', 3);
  });

  test('should filter by character when character parameter provided', async () => {
    mockSend
      // alias-index query: the user's favorited quoteIds
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }]
      })
      // character-index query: quoteIds for the requested character
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote1' }]
      })
      // GetCommand for the chosen quote
      .mockResolvedValueOnce({
        Item: { quoteId: 'quote1', character: 'Arthur', text: 'Arthur quote' }
      })
      // countLikes query
      .mockResolvedValueOnce({
        Count: 2
      });

    const event = {
      queryStringParameters: { alias: 'testuser', character: 'Arthur' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.character).toBe('Arthur');
  });

  test('should return 404 when no favorites match the character filter', async () => {
    mockSend
      // alias-index query: the user's favorited quoteIds
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote1' }]
      })
      // character-index query: no overlap with the user's favorites
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote2' }]
      });

    const event = {
      queryStringParameters: { alias: 'testuser', character: 'Lancelot' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('No favorites found for alias: testuser and character: Lancelot');
  });
});