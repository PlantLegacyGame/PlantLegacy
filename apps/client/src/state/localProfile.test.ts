import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadProfile, PROFILE_KEY, type ProfileStorage, saveProfile } from './localProfile.ts';

function memoryStorage(initial?: Record<string, string>): ProfileStorage {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('local profile', () => {
  it('starts empty when nothing is stored', () => {
    assert.deepEqual(loadProfile(memoryStorage()), {
      displayName: '',
      avatar: null,
      tutorialSeen: false,
    });
  });

  it('round-trips a name and an avatar', () => {
    const storage = memoryStorage();
    saveProfile(storage, { displayName: 'Mossy Fern', avatar: 'data:image/png;base64,AAA' });
    assert.deepEqual(loadProfile(storage), {
      displayName: 'Mossy Fern',
      avatar: 'data:image/png;base64,AAA',
      tutorialSeen: false,
    });
  });

  it('remembers that the opening instructions were shown, and nothing else', () => {
    const storage = memoryStorage();
    saveProfile(storage, { tutorialSeen: true });
    saveProfile(storage, { displayName: 'Fern' });
    const profile = loadProfile(storage);
    assert.equal(profile.tutorialSeen, true, 'a later save keeps the flag');
    assert.equal(profile.displayName, 'Fern');
    // A garbage flag is not true by accident.
    saveProfile(storage, {});
    storage.setItem(PROFILE_KEY, JSON.stringify({ tutorialSeen: 'yes' }));
    assert.equal(loadProfile(storage).tutorialSeen, false, 'only a real true counts');
  });

  it('keeps the avatar when only the name changes', () => {
    const storage = memoryStorage();
    saveProfile(storage, { displayName: 'One', avatar: 'data:image/png;base64,AAA' });
    saveProfile(storage, { displayName: 'Two' });
    assert.equal(loadProfile(storage).avatar, 'data:image/png;base64,AAA');
    assert.equal(loadProfile(storage).displayName, 'Two');
  });

  it('clears the avatar on request', () => {
    const storage = memoryStorage();
    saveProfile(storage, { avatar: 'data:image/png;base64,AAA' });
    saveProfile(storage, { avatar: null });
    assert.equal(loadProfile(storage).avatar, null);
  });

  it('refuses a stored URL that is not an image', () => {
    const storage = memoryStorage({
      [PROFILE_KEY]: JSON.stringify({ displayName: 'Fern', avatar: 'javascript:alert(1)' }),
    });
    assert.equal(loadProfile(storage).avatar, null);
    assert.equal(loadProfile(storage).displayName, 'Fern');
  });

  it('survives a corrupt entry', () => {
    const storage = memoryStorage({ [PROFILE_KEY]: '{not json' });
    assert.deepEqual(loadProfile(storage), {
      displayName: '',
      avatar: null,
      tutorialSeen: false,
    });
  });
});
