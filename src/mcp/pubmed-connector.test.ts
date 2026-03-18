import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PubMedConnector } from './pubmed-connector.js';

// We test the abstract extraction logic by mocking fetchWithTimeout
// to return controlled XML responses.

function createConnectorWithMockedFetch(xml: string): PubMedConnector {
  const connector = new PubMedConnector();
  // Mock fetchWithTimeout to return our XML
  (connector as any).fetchWithTimeout = vi.fn().mockResolvedValue({
    text: () => Promise.resolve(xml),
  });
  return connector;
}

describe('PubMedConnector — pubmed_fetch_abstract', () => {
  it('extracts structured abstract with multiple labeled sections', async () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <Article>
              <ArticleTitle>Systematic Review of X</ArticleTitle>
              <Journal><Title>Journal of Testing</Title></Journal>
              <Abstract>
                <AbstractText Label="OBJECTIVE">To evaluate X.</AbstractText>
                <AbstractText Label="METHODS">We searched databases.</AbstractText>
                <AbstractText Label="RESULTS">10 studies were included.</AbstractText>
                <AbstractText Label="CONCLUSIONS">X is effective.</AbstractText>
              </Abstract>
            </Article>
          </MedlineCitation>
          <PubmedData>
            <History>
              <PubMedPubDate><Year>2024</Year></PubMedPubDate>
            </History>
          </PubmedData>
        </PubmedArticle>
      </PubmedArticleSet>
    `;

    const connector = createConnectorWithMockedFetch(xml);
    const result = await connector.executeTool('pubmed_fetch_abstract', { pmid: '12345678' });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('OBJECTIVE: To evaluate X.');
    expect(result.content).toContain('METHODS: We searched databases.');
    expect(result.content).toContain('RESULTS: 10 studies were included.');
    expect(result.content).toContain('CONCLUSIONS: X is effective.');
  });

  it('extracts simple non-structured abstract (single section, no label)', async () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <Article>
              <ArticleTitle>A Simple Study</ArticleTitle>
              <Journal><Title>Simple Journal</Title></Journal>
              <Abstract>
                <AbstractText>This is a plain abstract without sections.</AbstractText>
              </Abstract>
            </Article>
          </MedlineCitation>
          <PubmedData>
            <History>
              <PubMedPubDate><Year>2023</Year></PubMedPubDate>
            </History>
          </PubmedData>
        </PubmedArticle>
      </PubmedArticleSet>
    `;

    const connector = createConnectorWithMockedFetch(xml);
    const result = await connector.executeTool('pubmed_fetch_abstract', { pmid: '87654321' });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('This is a plain abstract without sections.');
    // Should NOT have label prefix for non-structured abstracts
    expect(result.content).not.toMatch(/^[A-Z]+: This is a plain/m);
  });

  it('returns no-data message when abstract and title are missing', async () => {
    const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><Article></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;

    const connector = createConnectorWithMockedFetch(xml);
    const result = await connector.executeTool('pubmed_fetch_abstract', { pmid: '00000000' });

    expect(result.content).toContain('No data found for PMID 00000000');
  });
});
