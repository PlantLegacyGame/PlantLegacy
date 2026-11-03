export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe: () => void;
}

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  subscribe<T>(eventName: string, handler: EventHandler<T>): EventSubscription {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    this.handlers.get(eventName)?.add(handler as EventHandler);

    return {
      unsubscribe: () => {
        this.handlers.get(eventName)?.delete(handler as EventHandler);
      },
    };
  }

  async publish<T>(eventName: string, event: T): Promise<void> {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    await Promise.all(
      Array.from(handlers).map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          console.error(`Event handler error for ${eventName}:`, error);
        }
      }),
    );
  }

  publishSync<T>(eventName: string, event: T): void {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`Event handler error for ${eventName}:`, error);
      }
    }
  }

  getHandlerCount(eventName: string): number {
    return this.handlers.get(eventName)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();

export const GAME_EVENTS = {
  PLANT_CREATED: 'plant_created',
  PLANT_GROWTH: 'plant_growth',
  PLANT_DAMAGE: 'plant_damage',
  PLANT_DEATH: 'plant_death',
  PLANT_TIER_CHANGE: 'plant_tier_change',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  RESOURCE_UPDATE: 'resource_update',
  TICK_BUDGET_WARNING: 'tick_budget_warning',
} as const;

export type GameEventName = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];
