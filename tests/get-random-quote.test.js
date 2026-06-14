
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
  ScanCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn()
}));

describe('get-random-quote', () => {
  let lambdaHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';
    process.env.FAVORITES_TABLE_NAME = 'test-favorites-table';
    
    delete require.cache[require.resolve('../lambdas/get-random-quote/index.mjs')];
    
    return import('../lambdas/get-random-quote/index.mjs').then(module => {
      lambdaHandler = module.lambdaHandler;
    });
  });

  test('should return single quote when no batchSize specified', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }]
      })
      .mockResolvedValueOnce({
        Item: {
          quoteId: 'quote1',
          character: 'Arthur',
          text: 'Test quote'
        }
      })
      .mockResolvedValueOnce({
        Count: 5
      });

    const event = {};
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('quoteId');
    expect(body).toHaveProperty('likes', 5);
  });

  test('should return multiple quotes when batchSize > 1', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }, { quoteId: 'quote3' }]
      })
      .mockResolvedValueOnce({
        Item: { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' }
      })
      .mockResolvedValueOnce({ Count: 3 })
      .mockResolvedValueOnce({
        Item: { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2' }
      })
      .mockResolvedValueOnce({ Count: 1 });

    const event = {
      queryStringParameters: { batchSize: '2' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('quotes');
    expect(body.quotes).toHaveLength(2);
  });

  test('should return 400 error when batchSize is invalid', async () => {
    const event = {
      queryStringParameters: { batchSize: '25' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('batchSize must be a number between 1 and 20');
  });

  test('should return 400 error when batchSize is not a number', async () => {
    const event = {
      queryStringParameters: { batchSize: 'invalid' }
    };
    const result = await lambdaHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('error');
  });
});