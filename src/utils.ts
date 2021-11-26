import { AugmentedEvent, AugmentedEvents } from "@polkadot/api/types";
import { EventRecord } from "@polkadot/types/interfaces";

const fromEntries = (xs: [string | number | symbol, any][]) =>
  xs.reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

export function PromiseAllObj(obj: {
  [k: string]: any;
}): Promise<{ [k: string]: any }> {
  return Promise.all(
    Object.entries(obj).map(([key, val]) =>
      val instanceof Promise
        ? val.then((res) => [key, res])
        : new Promise((res) => res([key, val]))
    )
  ).then((res: any[]) => fromEntries(res));
}

export type ExtractTuple<Event> = Event extends AugmentedEvent<'rxjs', infer T> ? T : never

export function getDataFromEvent<Module extends keyof AugmentedEvents<'rxjs'>,
    Event extends keyof AugmentedEvents<'rxjs'>[Module],
    Tuple extends ExtractTuple<AugmentedEvents<'rxjs'>[Module][Event]>,
    Index extends keyof Tuple>(
    events: EventRecord[],
    module: Module,
    eventName: Event,
    index: Index = 0 as Index,
): Tuple[Index] | undefined {
  const eventRecord = events.find((event) => event.event.method === eventName)

  if (!eventRecord) {
    return
  }

  const data = eventRecord.event.data as unknown as Tuple

  return data[index]
}