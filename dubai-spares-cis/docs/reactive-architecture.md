# Reactive architecture normalization

## Order module split

- `orderDomain.ts` — aggregate diffs and projection reasons.
- `orderRepository.ts` — persistence adapter for local order graph cache.
- `orderSyncEngine.ts` — sync responsibilities and coordinator boundary.
- `orderMutationQueue.ts` — mutation intent model and queue contract.
- `orderPhotoPipeline.ts` — photo normalization/upload pipeline boundary.
- `orderLeadMerge.ts` — lead/order merge responsibility boundary.
- `orderProjectionDispatcher.ts` — dependent projection routing from domain events.

## Domain event flow

Cross-module reactions now travel through the domain bus instead of direct feature-to-feature calls:

1. domain mutation emits a domain event
2. projection dispatcher determines dependent projections/channels
3. reactive sync coordinator decides realtime/polling/fallback mode
4. diagnostics capture event, subscribers, queue/cloud targets, and projection reasons

## Source-of-truth policy

The codebase now exposes a typed `SOURCE_OF_TRUTH_POLICIES` map covering:

- orders
- parts
- variants
- hunt sessions
- hunt waypoints
- gps pings
- public quote snapshots
- app settings
- customer activity
- telegram subscriptions

## Public quote projection model

Public quote refreshes now carry:

- `projection_reason`
- `projected_at`
- `source_order_updated_at`
- `projection_version`

and are scheduled from a single projection pipeline.
