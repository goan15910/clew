------------------------------- MODULE Fulfil -------------------------------
(*
  A synthetic model for clew spec projection: an order that is paid, packed in
  two shipments, and closed, beside a newsletter that has nothing to do with it.
  It has the shape clew spec canon export writes. See docs/projection.md.
*)
EXTENDS Naturals, FiniteSets

Null == "null"

OrderStates == {"draft", "submitted", "approved", "closed", "cancelled"}
PaymentStates == {"paid", "refunded"}
Shipment == {"shipment1", "shipment2"}
ShipmentStates == {"packed", "shipped"}
StockStates == {"available", "empty"}
NewsletterStates == {"subscribed", "unsubscribed"}

VARIABLES order_status, payment_status, shipment_status, stock_status, newsletter_status
vars == <<order_status, payment_status, shipment_status, stock_status, newsletter_status>>

TypeOK ==
  /\ order_status \in OrderStates
  /\ payment_status \in PaymentStates \cup {Null}
  /\ shipment_status \in [Shipment -> ShipmentStates \cup {Null}]
  /\ stock_status \in StockStates
  /\ newsletter_status \in NewsletterStates

Init ==
  /\ order_status = "draft"
  /\ payment_status = Null
  /\ shipment_status = [i \in Shipment |-> Null]
  /\ stock_status \in StockStates   \* abstract: no sentence changes it
  /\ newsletter_status = "unsubscribed"

\* s1: "The customer submits the draft order as submitted."
SubmitOrder_s1 ==
  /\ order_status = "draft"
  /\ order_status' = "submitted"
  /\ UNCHANGED <<payment_status, shipment_status, stock_status, newsletter_status>>

\* s2: "The customer pays a new payment as paid when the order is submitted."
PayPayment_s2 ==
  /\ payment_status = Null
  /\ order_status = "submitted"
  /\ payment_status' = "paid"
  /\ UNCHANGED <<order_status, shipment_status, stock_status, newsletter_status>>

\* s3: "The manager approves the submitted order as approved when the payment is paid."
ApproveOrder_s3 ==
  /\ order_status = "submitted"
  /\ payment_status = "paid"
  /\ order_status' = "approved"
  /\ UNCHANGED <<payment_status, shipment_status, stock_status, newsletter_status>>

\* s4: "The warehouse packs a new shipment as packed when the order is approved and the stock is available."
PackShipment_s4(shipment) ==
  /\ shipment_status[shipment] = Null
  /\ order_status = "approved"
  /\ stock_status = "available"
  /\ shipment_status' = [shipment_status EXCEPT ![shipment] = "packed"]
  /\ UNCHANGED <<order_status, payment_status, stock_status, newsletter_status>>

\* s5: "The carrier ships the packed shipment as shipped."
ShipShipment_s5(shipment) ==
  /\ shipment_status[shipment] = "packed"
  /\ shipment_status' = [shipment_status EXCEPT ![shipment] = "shipped"]
  /\ UNCHANGED <<order_status, payment_status, stock_status, newsletter_status>>

\* s6: "The customer closes the approved order as closed when each shipment is shipped."
CloseOrder_s6 ==
  /\ order_status = "approved"
  /\ (\A shipment_q1 \in Shipment : shipment_status[shipment_q1] = "shipped")
  /\ order_status' = "closed"
  /\ UNCHANGED <<payment_status, shipment_status, stock_status, newsletter_status>>

\* s7 branch 1: "The customer cancels the order as cancelled and the system refunds the paid payment as refunded when the order is submitted or approved and no shipment is shipped."
CancelOrder_s7_1 ==
  /\ order_status \in {"submitted", "approved"}
  /\ payment_status = "paid"
  /\ (~(\E shipment_q2 \in Shipment : shipment_status[shipment_q2] = "shipped"))
  /\ order_status' = "cancelled"
  /\ payment_status' = "refunded"
  /\ UNCHANGED <<shipment_status, stock_status, newsletter_status>>

\* s7 branch 2: "or cancels the submitted order as cancelled when the payment is not paid."
CancelOrder_s7_2 ==
  /\ order_status = "submitted"
  /\ payment_status # "paid"
  /\ order_status' = "cancelled"
  /\ UNCHANGED <<payment_status, shipment_status, stock_status, newsletter_status>>

\* s8: "The customer subscribes the unsubscribed newsletter as subscribed."
SubscribeNewsletter_s8 ==
  /\ newsletter_status = "unsubscribed"
  /\ newsletter_status' = "subscribed"
  /\ UNCHANGED <<order_status, payment_status, shipment_status, stock_status>>

\* s9: "The customer unsubscribes the subscribed newsletter as unsubscribed."
UnsubscribeNewsletter_s9 ==
  /\ newsletter_status = "subscribed"
  /\ newsletter_status' = "unsubscribed"
  /\ UNCHANGED <<order_status, payment_status, shipment_status, stock_status>>

\* Every step the sentences state.
Actions ==
  \/ SubmitOrder_s1
  \/ PayPayment_s2
  \/ ApproveOrder_s3
  \/ \E shipment \in Shipment : PackShipment_s4(shipment)
  \/ \E shipment \in Shipment : ShipShipment_s5(shipment)
  \/ CloseOrder_s6
  \/ CancelOrder_s7_1
  \/ CancelOrder_s7_2
  \/ SubscribeNewsletter_s8
  \/ UnsubscribeNewsletter_s9

\* Conditions no sentence sets: the environment changes them, one at a time.
Environment ==
  \/ (stock_status' \in StockStates /\ UNCHANGED <<order_status, payment_status, shipment_status, newsletter_status>>)

Next == Actions \/ Environment

Spec == Init /\ [][Next]_vars

\* Every object with a final state is in one.
Done == order_status \in {"closed", "cancelled"}

\* s10: "The order is never closed when the payment is refunded."
InvOrder_s10 == ~(order_status = "closed" /\ payment_status = "refunded")

=============================================================================
