
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
  GetCommand: jest.fn()
}));

describe('get-favorite-status', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';
    
    delete require.cache[require.resolve('../lambdas/get-favorite-status/index.mjs')];
    
    return import('../lambdas/get-favorite-status/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should return 400 error when quoteId is missing', async () => {
    const event = {
      queryStringParameters: { alias: 'testuser' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Missing required query parameters: quoteId, alias');
  });

  test('should return 400 error when alias is missing', async () => {
    const event = {
      queryStringParameters: { quoteId: 'quote1' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Missing required query parameters: quoteId, alias');
  });

  test('should return liked: true when quote is favorited', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { quoteId: 'quote1', alias: 'testuser' }
    });

    const event = {
      queryStringParameters: { quoteId: 'quote1', alias: 'testuser' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('quoteId', 'quote1');
    expect(body).toHaveProperty('alias', 'testuser');
    expect(body).toHaveProperty('liked', true);
  });

  test('should return liked: false when quote is not favorited', async () => {
    mockSend.mockResolvedValueOnce({
      Item: undefined
    });

    const event = {
      queryStringParameters: { quoteId: 'quote1', alias: 'testuser' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('quoteId', 'quote1');
    expect(body).toHaveProperty('alias', 'testuser');
    expect(body).toHaveProperty('liked', false);
  });
});