# Order workflows

Each heading names one workflow and what TLC must show for it. A step is a sentence in the canonical grammar.

## Happy path (possible)

1. The customer submits the order as submitted.
2. The manager reviews the order as approved when the total is small.
3. The warehouse ships the order as shipped.
4. The order ends as shipped.

## Approve before submit (refused, exact)

1. The manager reviews the order as approved.

## Reject a draft (refused)

1. The manager reviews the draft order as rejected.

## Ship a large order (refused)

1. The total starts as large.
2. The customer submits the order as submitted.
3. The warehouse ships the order as shipped.
