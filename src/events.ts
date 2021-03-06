import React from 'react'
import {
  unstable_NormalPriority as NormalPriority,
  unstable_runWithPriority as runWithPriority
} from 'scheduler'

import { isDev, useIsomorphicLayoutEffect } from './common'

/**
 * Types
 */
type ContextListener<Value> = (value: Readonly<Value>) => void

type EventKey = string | number | symbol

type EventMiddleware<In extends Readonly<unknown>[], Out> = (
  ...payload: In
) => Out

type EventListener<Payload> = (payload: Readonly<Payload>) => void

type EventRegistry<
  Key extends EventKey,
  Event extends EventMiddleware<any, any>
> = Record<Key, Event>

type EventState = Readonly<{ type: EventKey; payloadArgs: any[] }>

type EventDispatcher = (event: EventState) => void

/**
 * Constants
 */

const EVENT_DISPATCHED_NULL: EventDispatcher = () => {
  /* istanbul ignore next */
  if (isDev) {
    console.warn('Tried to dispatch event without Provider')
  }
}

export default function events<
  Key extends EventKey,
  Middleware extends EventMiddleware<any, any>,
  Registry extends EventRegistry<Key, Middleware>
>(middlewares: Registry) {
  type ListenerRegistry = {
    [key in keyof Partial<Registry>]: EventListener<ReturnType<Registry[key]>>
  }

  const dispatcher: { current: EventDispatcher } = {
    current: EVENT_DISPATCHED_NULL
  }
  const contextListeners: ContextListener<EventState>[] = []

  /**
   * Proxy Dispatcher for easier use
   * @param event
   * @param payload
   */
  type Dispatcher = {
    [key in keyof Registry]: (...payload: Parameters<Registry[key]>) => void
  }
  const proxyDispatcher = new Proxy(dispatcher, {
    get: ({ current: targetDispatcher }, type) => {
      return (...payloadArgs: unknown[]) =>
        targetDispatcher({ type, payloadArgs })
    }
  }) as unknown as Dispatcher

  /**
   * Informat
   * @param eventListeners ListenerRegistry
   * @returns void
   */
  const informant: (
    eventListeners?: ListenerRegistry
  ) => ContextListener<EventState> =
    (eventListeners?: ListenerRegistry) => (event: EventState) => {
      eventListeners?.[event.type]?.(
        middlewares[event.type](...event.payloadArgs)
      )
    }

  /**
   * Provider
   */
  const BindProvider: React.FC = (props) => {
    // setEvent is never updated
    const [events, setEvents] = React.useState<EventState[]>([])
    dispatcher.current = React.useCallback(
      (event: EventState) => setEvents((oldEvents) => [...oldEvents, event]),
      [setEvents]
    )

    useIsomorphicLayoutEffect(() => {
      runWithPriority(NormalPriority, () => {
        contextListeners.forEach((listener) => {
          events.forEach((event) => listener(event))
        })
      })

      // Removing events without render
      events.splice(0, events.length)
    }, [events])

    return React.createElement(React.Fragment, props)
  }

  /**
   * useEvent hook
   * @param eventListeners List of subscribed events
   * @returns Dispatch function
   */
  const useEvent = (eventListeners?: ListenerRegistry) => {
    // EventListener caller
    const update = React.useCallback(informant(eventListeners), [
      eventListeners
    ])

    // Adding listener on component initialization
    useIsomorphicLayoutEffect(() => {
      contextListeners.push(update)

      return () => {
        const index = contextListeners.indexOf(update)
        contextListeners.splice(index, 1)
      }
    }, [contextListeners])

    return proxyDispatcher
  }

  /**
   * Subscriber for non-hook aproaches
   * @param eventListeners List of subscribed events
   * @returns Subscriber with unsubscribe method
   */
  const subscribe = (eventListeners: ListenerRegistry) => {
    const subscriber: ContextListener<EventState> = informant(eventListeners)

    contextListeners.push(subscriber)

    const unsubscribe = () => {
      const index = contextListeners.indexOf(subscriber)
      contextListeners.splice(index, 1)
    }

    return { unsubscribe }
  }

  return [
    BindProvider,
    useEvent,
    { subscribe, dispatcher: proxyDispatcher }
  ] as const
}
