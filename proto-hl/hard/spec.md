# Hard cases
The purchase order starts as draft.
The customer submits a new purchase order as submitted.
The account manager signs off the submitted purchase order as approved when the total is small, or holds the submitted purchase order as On Hold when the total is large.
The account manager releases the On Hold purchase order as approved and the warehouse starts the approved purchase order as picking when each invoice is paid.
The warehouse ships the picking purchase order as shipped when the purchase order is not On Hold and either the total is small or the invoice is paid.
The customer can cancel the submitted purchase order as cancelled, or cannot cancel the shipped purchase order.
The purchase order is never shipped when the total is large and no invoice is paid.
The purchase order ends as shipped or cancelled.
After the dispute, the account manager holds the approved purchase order as On Hold.
The customer pays the invoice of the purchase order as paid.
The warehouse ships it again when they are ready.
