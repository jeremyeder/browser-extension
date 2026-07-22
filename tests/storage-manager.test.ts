import { StorageManager } from '../src/background/storage-manager';
import type { Task } from '../src/types';

// Mock chrome storage APIs
const store: Record<string, unknown> = {};

global.chrome = {
  storage: {
    sync: {
      get: jest.fn((key: string) => Promise.resolve({ [key]: store[key] })),
      set: jest.fn((obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      }),
    },
    local: {
      get: jest.fn((key: string) => Promise.resolve({ [key]: store[key] })),
      set: jest.fn((obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      }),
    },
    session: {
      get: jest.fn((key: string) => Promise.resolve({ [key]: store[key] })),
      set: jest.fn((obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      }),
      remove: jest.fn((key: string) => {
        delete store[key];
        return Promise.resolve();
      }),
    },
  },
} as unknown as typeof chrome;

describe('StorageManager', () => {
  let storage: StorageManager;

  beforeEach(() => {
    storage = new StorageManager();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('returns default settings when none stored', async () => {
    const settings = await storage.getSettings();
    expect(settings.modelId).toBe('claude-sonnet-4-6');
    expect(settings.maxTokens).toBe(4096);
  });

  it('saves and retrieves settings', async () => {
    await storage.updateSettings({ maxTokens: 1024 });
    const settings = await storage.getSettings();
    expect(settings.maxTokens).toBe(1024);
  });

  it('creates a task with generated id', async () => {
    const task = await storage.createTask({
      title: 'Test task',
      status: 'todo',
      priority: 'medium',
    });
    expect(task.id).toMatch(/^task_/);
    expect(task.title).toBe('Test task');
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it('lists created tasks', async () => {
    await storage.createTask({ title: 'A', status: 'todo', priority: 'low' });
    await storage.createTask({ title: 'B', status: 'todo', priority: 'high' });
    const tasks = await storage.getTasks();
    expect(tasks).toHaveLength(2);
  });

  it('updates a task', async () => {
    const task = await storage.createTask({ title: 'C', status: 'todo', priority: 'medium' });
    await storage.updateTask(task.id, { status: 'done' });
    const tasks = await storage.getTasks();
    const updated = tasks.find((t: Task) => t.id === task.id);
    expect(updated?.status).toBe('done');
  });

  it('deletes a task', async () => {
    const task = await storage.createTask({ title: 'D', status: 'todo', priority: 'low' });
    await storage.deleteTask(task.id);
    const tasks = await storage.getTasks();
    expect(tasks.find((t: Task) => t.id === task.id)).toBeUndefined();
  });
});
