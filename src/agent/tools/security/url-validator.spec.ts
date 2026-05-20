import { lookup } from 'dns/promises';
import { validateUrl } from './url-validator';

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('validateUrl', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('rejects localhost literals', async () => {
    await expect(validateUrl('http://127.0.0.1/status')).resolves.toMatchObject(
      {
        valid: false,
      },
    );
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ] as never);

    await expect(validateUrl('https://example.test')).resolves.toMatchObject({
      valid: false,
    });
  });

  it('allows public resolved addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);

    await expect(validateUrl('https://example.com')).resolves.toEqual({
      valid: true,
    });
  });
});
