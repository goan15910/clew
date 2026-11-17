# Order

The order starts as draft.
The customer submits the draft order as submitted.
The manager reviews the submitted order as approved when the total is small, or reviews the order as rejected when the total is large.
The warehouse ships the order as shipped when the order is packed.
The customer cancels the order as cancelled when the order is submitted or approved.
The customer cannot cancel the order when the order is shipped.
The order ends as shipped, rejected or cancelled.
The order is never shipped when the total is large.
Once the order is approved, the warehouse must pack it.
