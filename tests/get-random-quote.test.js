
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

  // The quoteId list is cached at module level, so these tests load a fresh module to force a new scan.
  // mockReset also drops queued responses that earlier tests left unconsumed because of that cache.
  const freshHandler = async () => {
    mockSend.mockReset();
    jest.resetModules();
    return (await import('../lambdas/get-random-quote/index.mjs')).lambdaHandler;
  };

  test('should follow scan pagination past pages without items', async () => {
    const handler = await freshHandler();
    mockSend
      .mockResolvedValueOnce({ LastEvaluatedKey: { quoteId: 'quote0' } })
      .mockResolvedValueOnce({ Items: [{ quoteId: 'quote1' }] })
      .mockResolvedValueOnce({ Item: { quoteId: 'quote1', character: 'Arthur', text: 'Test quote' } })
      .mockResolvedValueOnce({ Count: 2 });

    const result = await handler({});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({ quoteId: 'quote1', likes: 2 });
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  test('should skip quotes already picked in a batch', async () => {
    const handler = await freshHandler();
    const randomSpy = jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.6);
    mockSend
      .mockResolvedValueOnce({ Items: [{ quoteId: 'quote1' }, { quoteId: 'quote2' }] })
      .mockResolvedValueOnce({ Item: { quoteId: 'quote1', character: 'Arthur', text: 'Test quote 1' } })
      .mockResolvedValueOnce({ Count: 0 })
      .mockResolvedValueOnce({ Item: { quoteId: 'quote2', character: 'Lancelot', text: 'Test quote 2' } })
      .mockResolvedValueOnce({ Count: 0 });

    const result = await handler({ queryStringParameters: { batchSize: '2' } });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.quotes.map(q => q.quoteId)).toEqual(['quote1', 'quote2']);
    expect(randomSpy).toHaveBeenCalledTimes(3);
    randomSpy.mockRestore();
  });
});
