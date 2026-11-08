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
  ScanCommand: jest.fn()
}));

describe('get-all-quotes', () => {
  let lambdaHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-quotes-table';

    ({ lambdaHandler } = await import('../lambdas/get-all-quotes/index.mjs'));
  });

  test('should return every quote sorted by quoteId, with a browser cache header', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { quoteId: 'b', character: 'Perceval', text: 'C’est pas faux.' },
        { quoteId: 'a', character: 'Arthur', text: 'Non.' }
      ]
    });

    const result = await lambdaHandler();

    expect(result.statusCode).toBe(200);
    expect(result.headers['Cache-Control']).toBe('public, max-age=3600');
    const body = JSON.parse(result.body);
    expect(body.quotes.map(q => q.quoteId)).toEqual(['a', 'b']);
    expect(body.quotes[0]).toEqual({ quoteId: 'a', character: 'Arthur', text: 'Non.' });
  });

  test('should follow pagination', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ quoteId: 'a' }], LastEvaluatedKey: { quoteId: 'a' } })
      .mockResolvedValueOnce({ Items: [{ quoteId: 'b' }] });

    const result = await lambdaHandler();

    expect(JSON.parse(result.body).quotes).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('should serve reloaded quotes on a warm invocation, with no stale cache', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ quoteId: 'a' }] })
      .mockResolvedValueOnce({ Items: [{ quoteId: 'a' }, { quoteId: 'b' }] });

    await lambdaHandler();
    const result = await lambdaHandler();

    expect(JSON.parse(result.body).quotes).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
