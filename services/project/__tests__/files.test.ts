/**
 * Round-trip and refusal behavior for the three project file formats.
 * (P1 acceptance: 生成/解析往返、版本拒绝 — see docs/storyflow-adoption-plan.md.)
 */
import { describe, expect, it } from 'vitest';
import type { Screenplay } from '../../../types';
import {
  ProjectFileError,
  RUN_FORMAT,
  STORY_FORMAT,
  STYLE_FORMAT,
  parseRunFile,
  parseStoryFile,
  parseStyleFile,
  runFileName,
  runNameFromFile,
  serializeRunFile,
  serializeStoryFile,
  serializeStyleFile,
  type RunFileData,
  type StyleFileData,
} from '../files';
import { buildDefaultRun, buildProjectScaffold, buildStyleFileData } from '../migrate';

const sampleScreenplay = {
  id: 'sp_test1',
  metadata: {
    title: 'Test',
    author: 'A',
    draft: '1',
    scriptLanguage: 'en',
    styleHead: {
      name: '赛博霓虹',
      artStyle: 'cinematic',
      scenePreset: 'night city',
      promptPrefix: 'neon noir,',
    },
  },
  blocks: [{ id: 'b1', type: 'SCENE_HEADING', content: 'INT. ROOM - DAY' }],
  lastModified: 1758000000000,
  productionMode: 'cinematic',
} as unknown as Screenplay;

describe('story.sfstory', () => {
  it('round-trips a screenplay losslessly', () => {
    const parsed = parseStoryFile(serializeStoryFile(sampleScreenplay));
    expect(parsed.screenplay).toEqual(sampleScreenplay);
  });

  it('stamps the format id and pretty-prints for diffs', () => {
    const text = serializeStoryFile(sampleScreenplay);
    expect(text).toContain(`"format": "${STORY_FORMAT}"`);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  '); // indented = git-friendly
  });

  it('refuses a different format major by name', () => {
    const text = serializeStoryFile(sampleScreenplay).replace(STORY_FORMAT, 'storyflow.story@2');
    expect(() => parseStoryFile(text)).toThrow(ProjectFileError);
    expect(() => parseStoryFile(text)).toThrow(/storyflow.story@2.*storyflow.story@1/);
  });

  it('refuses broken JSON and non-envelopes', () => {
    expect(() => parseStoryFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseStoryFile('{"hello":1}')).toThrow(/no "format" envelope/);
  });

  it('refuses a story without id + blocks', () => {
    const text = JSON.stringify({ format: STORY_FORMAT, data: { screenplay: { id: 'x' } } });
    expect(() => parseStoryFile(text)).toThrow(/id \+ blocks/);
  });
});

describe('style.sfstyle', () => {
  const style: StyleFileData = buildStyleFileData(sampleScreenplay.metadata.styleHead, {
    SCENE_HEADING: '#ff0000',
    DIALOGUE: '#00ff00',
  } as StyleFileData['colorSettings']);

  it('round-trips style head, colors and null overrides', () => {
    const parsed = parseStyleFile(serializeStyleFile(style));
    expect(parsed).toEqual(style);
  });

  it('defaults missing fields to null rather than guessing', () => {
    const parsed = parseStyleFile(`{"format": "${STYLE_FORMAT}", "data": {}}`);
    expect(parsed).toEqual({ styleHead: null, colorSettings: null, promptOverrides: null });
  });

  it('refuses a wrong format id', () => {
    expect(() => parseStyleFile(serializeStyleFile(style).replace(STYLE_FORMAT, 'styleflow@1')))
      .toThrow(ProjectFileError);
  });
});

describe('runs/<name>.sfrun', () => {
  it('round-trips a run with a reserved empty candidate list', () => {
    const run = buildDefaultRun('cut-a');
    const parsed = parseRunFile(serializeRunFile(run));
    expect(parsed).toEqual(run);
    expect(parsed.candidates).toEqual([]); // P3 fills these; P1 keeps the slot
  });

  it('round-trips block-scoped selection', () => {
    const run: RunFileData = {
      name: 'hook-variants',
      createdAt: 1,
      selection: { kind: 'blocks', blockIds: ['b1', 'b2'] },
      productionMode: 'simple',
      candidates: [],
      satisfactions: [],
    };
    expect(parseRunFile(serializeRunFile(run))).toEqual(run);
  });

  it('refuses a run without a valid selection', () => {
    const text = JSON.stringify({ format: RUN_FORMAT, data: { name: 'x', selection: 'everything' } });
    expect(() => parseRunFile(text)).toThrow(/valid selection/);
  });

  it('maps names to file names and back', () => {
    expect(runFileName('main')).toBe('main.sfrun');
    expect(runFileName('main.sfrun')).toBe('main.sfrun');
    expect(runNameFromFile('main.sfrun')).toBe('main');
  });
});

describe('project scaffold', () => {
  it('builds all three files with one run, story and style wired to the screenplay', () => {
    const scaffold = buildProjectScaffold(sampleScreenplay, {
      styleHead: sampleScreenplay.metadata.styleHead,
      colorSettings: null,
    });
    expect(Object.keys(scaffold.runs)).toEqual(['main.sfrun']);
    expect(parseStoryFile(scaffold.story).screenplay).toEqual(sampleScreenplay);
    expect(parseStyleFile(scaffold.style).styleHead).toEqual(sampleScreenplay.metadata.styleHead);
    expect(parseRunFile(scaffold.runs['main.sfrun']).selection).toEqual({ kind: 'all' });
  });
});
