# Saoirse

## A personal banker for everyone.

> What if digital banking didn't just let customers use the bank, what if it understood what they were trying to achieve and helped them get there?

Saoirse is a conversational orchestration layer over simulated retail banking product journeys for a fictional Demo Bank. It is an experimental AI-powered relationship layer for retail banking.

It is an attempt to answer a simple question:

> Can AI give every retail customer the kind of continuity, context and personal service that has traditionally only been possible in private banking?

We think it can.

And we think that could fundamentally change what digital banking feels like.

---

# Why Saoirse exists

Digital banking has become very good at digitising banking processes.

You can:

- check a balance;
- transfer money;
- apply for a loan;
- open an account;
- start a mortgage application;
- upload documents;
- track some applications.

But the underlying interaction model hasn't changed very much.

The customer still has to understand how the bank is organised.

If you want a mortgage, you find Mortgages.

If you need a loan, you find Loans.

If you've just had a baby, got married and are trying to buy your first home, the bank typically sees several unrelated product journeys.

The customer sees one thing:

> My life has changed. Help me work out what I need to do.

That is the gap Saoirse is exploring.

---

# This is not another chatbot

The ambition is not to put an LLM inside a speech bubble and let customers ask questions about banking.

That would be useful.

It would also be nowhere near enough.

Saoirse is intended to be a **persistent digital relationship manager**.

It should understand:

- who the customer is;
- what they are trying to achieve;
- what has changed in their life;
- what the bank already knows;
- what information the customer has already provided;
- what financial needs may exist;
- which of those needs matter now;
- which should wait;
- what applications are in progress;
- what milestones are approaching;
- what the next useful action is.

And, critically:

> **Saoirse should stay with the customer after the conversation ends.**

---

# Imagine this

A customer arrives on the Demo Bank website and says:

> _"My wife and I want to buy our first house."_

Saoirse doesn't immediately throw them into a mortgage form.

It asks a few useful questions.

It learns that:

- they recently got married;
- they've just had their first child;
- they're first-time buyers;
- they have €46,000 saved;
- they're saving €2,500 per month;
- they're targeting a €600,000 home;
- they still manage most of their finances separately;
- they're around six months away from their deposit target.

Saoirse can then say:

> You're probably a little early to start the full mortgage application today.
>
> If you'd like, we can build a plan instead.
>
> I'll keep track of the deposit with you, help get everything ready, and we can come back to the mortgage when there's actually something useful to do.

That creates:

### Buy our first home

**Deposit goal**  
€46,000 / €60,000

**Current trajectory**  
On track for approximately six months

**Next steps**

Prepare for mortgage readiness.

Consider whether a shared household account would be useful.

Make sure the emergency reserve isn't accidentally consumed by the deposit.

Review protection at the appropriate point.

And perhaps:

**Next check-in**  
12 November

Not an appointment with a member of staff.

An conversation with **Saoirse**.

---

# Then Saoirse remembers

A month later:

> Last time we spoke you had €46,000 saved and were putting away around €2,500 a month. How are things looking now?

The customer says:

> We're at €49,500.

The plan updates.

Months later, the deposit reaches the customers target.

Saoirse can come back:

> You've reached the €60,000 deposit target you set.
>
> When we last spoke, you agreed this would be the point to review your mortgage readiness.
>
> Want to do that now?

The customer hasn't been targeted because an advertising model thinks they look like a mortgage prospect.

They are hearing from the bank because:

> **the customer and the bank agreed on a goal together.**

That distinction matters.

---

# The bank should understand intent, not just transactions

Traditional banking systems are excellent at storing:

> **Transactions**

Digital banking added:

> **Products**

Saoirse discovers:

> **Intent**

And the _Goal Engine_ introduces:

> **Trajectory**

The relationship starts to answer four much more useful questions:

> **Where are you trying to get to?**

> **Where are you now?**

> **What's the next useful thing we can do?**

> **When should we speak again?**

That is what we mean by conversational relationship banking.

---

# Private-banking-grade service at retail scale

Private banking is not valuable because someone can manually navigate a form on a customer's behalf.

The valuable part is continuity.

Someone knows:

- what you are trying to achieve;
- what you discussed last time;
- what decisions were made;
- what still needs to happen;
- what can wait;
- when it is worth speaking again.

Historically, providing that service to millions of retail customers would have been economically impossible.

AI changes that.

Saoirse asks:

> **What happens if we make that level of relationship available to everybody?**

Not by pretending every customer has a human private banker.

By building a digital service capable of providing the continuity, memory and orchestration that made the relationship valuable in the first place.

---

# One relationship, not five product journeys

Consider a customer who:

- got married;
- had a baby;
- wants to buy their first home.

A traditional bank may see:

```text
Mortgage
Joint Account
Savings
Credit Card
Personal Loan
Mortgage Protection
Life Protection
Home Insurance
```

Saoirse should see:

```text
Life circumstances
        ↓
Goals
        ↓
Milestones
        ↓
Financial needs
        ↓
Banking actions
        ↓
Products and applications
```

Products become tools.

The customer's goal remains the organising principle.

---

# Goals, not cross-sell

If a customer says:

> _"We just had our first baby."_

Saoirse should not respond:

> Would you like some life insurance?

A baby may create several possible financial considerations:

```text
New baby
│
├── Household budget
├── Emergency reserve
├── Family protection
├── Income resilience
├── Child saving
├── Shared finances
└── Potential housing change
```

Saoirse's job is to understand what matters to this customer.

Maybe all they want is:

> We want to save €100 per month for her.

Great.

Create:

### Save for Aoife

€100 / month  
18-year horizon

And help them do that.

The plan belongs to the customer.

The products serve the plan.

---

# Timing matters

A good banker doesn't just know what might be relevant.

They know **when** it is relevant.

Suppose our home-buying customer says:

> We'll probably need another €15,000 to renovate the house.

That creates a valid future borrowing need.

But taking on new borrowing during a mortgage assessment could be unhelpful.

Saoirse should be capable of saying:

> We can absolutely look at that.
>
> Because you're currently working towards the mortgage, I'd suggest we park the renovation borrowing for now and come back to it once the mortgage has completed.
>
> Want me to remember that?

Later:

> When we were preparing your mortgage, you mentioned around €15,000 of work on the house. Now that the mortgage has completed, do you still want to look at that?

That's not cross-selling, it's supporting the customers real financial needs, and importantly to the customer it feels like:

> **the bank remembered.**

---

# Ask once

Customers repeatedly give banks the same information.

Address.

Employment.

Salary.

Dependants.

Savings.

Existing borrowing.

Identification.

Saoirse should maintain structured customer context so that information can be reused appropriately across journeys.

If the customer tells us their annual income once, and that information can legitimately satisfy requirements in four different applications, the customer shouldn't need to answer the same question four times.

Where information needs to be reconfirmed, Saoirse asks.

Where a declaration must be completed separately, Saoirse asks.

Where information is sensitive or application-specific, Saoirse does not make assumptions.

But the principle is simple:

> **Don't make customers repeatedly explain things the bank already knows.**

---

# Applications become orchestration

Saoirse is not intended to replace existing banking processes.

That is part of the point.

Existing product journeys can continue to define:

- required questions;
- validation;
- eligibility;
- underwriting;
- credit policy;
- declarations;
- decisioning;
- fulfilment.

Saoirse sits above them.

The conversation gathers information naturally.

Structured orchestration determines what each underlying journey still requires.

The customer sees:

> **one conversation**

while the bank may be progressing:

```text
Mortgage
├── 38 / 46 requirements satisfied

Joint account
├── Waiting for partner

Credit card
├── Ready for customer confirmation

Protection
├── More information required

Personal loan
└── Deliberately deferred
```

That is the orchestration layer.

---

# Saoirse does the digital grunt work

The customer should not need to know which internal system owns a task.

Saoirse should be able to:

- gather application information;
- map answers into existing journeys;
- reuse information appropriately;
- invite a partner;
- request documents;
- monitor application state;
- explain what changed;
- remind the customer when something is required;
- pause journeys;
- resume them later;
- schedule future check-ins;
- bring in a human adviser where needed.

The ambition is:

> **Customers tell the bank what they are trying to accomplish. Saoirse figures out how the bank needs to organise itself around that objective.**

---

# The Goal Engine

Saoirse includes a machine-readable model of common retail financial goals.

Examples include:

```text
Get finances organised
Build an emergency fund
Reduce debt
Save for something
Buy first home
Move home
Build a home
Renovate
Buy a car
Combine finances
Prepare for a baby
Save for a child
Protect family finances
Protect income
Fund education
Move country
Respond to income change
Manage a lump sum
Start investing
Build wealth
Start a pension
Prepare for retirement
Transition into retirement
```

Goals contain:

- discovery signals;
- information required;
- milestones;
- related goals;
- prerequisites;
- conflicts;
- follow-on goals;
- relevant needs;
- check-in patterns.

This means the AI doesn't have to invent someone's financial journey from scratch every time.

The model understands the conversation.

The Goal Engine understands the map.

---

# The Needs Engine

Goals create needs.

For example:

```text
BUY_FIRST_HOME

Needs
├── Deposit saving
├── Mortgage
├── Shared household finances
├── Mortgage protection
├── Home insurance
└── Post-purchase liquidity
```

The Needs Engine determines:

- how strongly a need is evidenced;
- whether clarification is required;
- whether it should be surfaced now;
- whether it should be deferred;
- whether another customer goal conflicts with it;
- what Demo Bank products or services can help.

A product can therefore be:

> **relevant but inappropriate right now.**

That is a critical distinction.

---

# Customer Plans

Once a customer chooses to pursue a goal, Saoirse can create a persistent plan.

A plan can contain:

```text
Goal

Target
Target date

Current position

Milestones

Actions
├── Customer
├── Partner
├── Saoirse
└── Bank

Check-ins

Needs
├── Active
├── Deferred
└── Completed

Applications

Events
```

Plans survive individual sessions.

Applications belong to plans.

The plan does not disappear when an application is submitted.

---

# Check-ins

Saoirse should be able to schedule useful future conversations.

For example:

### Mortgage readiness check

**15 January**

Agenda:

1. Check deposit progress.
2. Confirm household income.
3. Review property-search status.
4. Check documentation.
5. Decide whether to begin the application.

If there is nothing useful to discuss, Saoirse should say so.

> You're still on track and I don't need anything from you right now. I'll check again next month unless something changes.

Good banking should not manufacture engagement.

---

# Event-driven banking

Check-ins do not have to be date-based.

Saoirse can respond when something meaningful happens.

Examples:

```text
Deposit target reached
Mortgage application changes state
Partner completes their section
Document requested
Fixed term nearing expiry
Savings product matures
Income changes
Goal goes off-track
Mortgage completes
```

An event can:

```text
update milestone
        ↓
recalculate plan
        ↓
activate/defer need
        ↓
create action
        ↓
decide whether customer contact is useful
```

This turns digital banking from reactive software into an ongoing service.

---

# Humans still matter

Saoirse should not try to automate everything.

Sometimes the correct action is:

> **Speak to a person.**

The important difference is that the customer shouldn't have to start again.

Saoirse can hand the adviser:

- customer objective;
- plan;
- known context;
- previous decisions;
- relevant conversation summary;
- current applications;
- outstanding questions.

Instead of:

> "Can I take your name and ask why you're calling?"

the human can begin with:

> "I've read through the home-buying plan you've been working on with Saoirse. Let's look at the two things that are still unresolved."

AI shouldn't remove human service.

It should make human service better.

---

# Domain boundaries

Saoirse is a banking assistant.

It is deliberately **not** general-purpose ChatGPT.

It should not become:

- a trivia engine;
- a coding assistant;
- an essay writer;
- an assistant for competitor-bank products;
- an unrestricted general-purpose model.

If someone asks:

> Who won the 1998 World Cup?

Saoirse can say:

> Tempting, but wildly outside my job description. Banking I can help with.

And remain focused.

The bank controls the domain.

---

# Personality is configurable

The bank also controls how Saoirse communicates.

The prototype includes the idea of configurable dimensions such as:

```text
Concise ↔ Detailed
Serious ↔ Funny
Straight ↔ Dry/Sarcastic
Casual ↔ Formal
Literal ↔ Playful
```

Including, because we can:

> **Poetic Saoirse**

The important separation is:

```text
Persona
= how Saoirse speaks

Policy
= what Saoirse may do
```

Changing the personality must never change:

- banking rules;
- customer protections;
- allowed actions;
- regulated boundaries;
- security controls.

---

# What we're building first

The initial POC deliberately focuses on one customer.

They are:

- an existing Demo Bank customer;
- recently married;
- a new parent;
- a first-time buyer;
- around six months away from their deposit target.

This scenario allows us to demonstrate:

```text
Public Demo Bank website
       ↓
Saoirse conversation
       ↓
Life-stage discovery
       ↓
Customer Plan
       ↓
Needs discovery
       ↓
Public → authenticated handoff
       ↓
Persistent context
       ↓
Multiple applications
       ↓
Partner participation
       ↓
Information reuse
       ↓
Deferred borrowing
       ↓
Customer leaves
       ↓
Plan milestone reached
       ↓
Notification
       ↓
Customer returns
       ↓
Saoirse continues where they left off
```

The POC uses synthetic customer information and simulated banking systems.

The goal is to prove the service model, not production infrastructure.

---

# The experience we're aiming for

We want someone to use the prototype and think:

> **Why doesn't my bank already work like this?**

Not:

> That's a clever chatbot.

If the reaction is simply that the AI is impressive, we've missed the point.

The interesting thing isn't the model.

It's what becomes possible when a bank can finally maintain:

```text
Context
+
Intent
+
Goals
+
Timing
+
Application state
+
Permission to act
```

across the entire customer relationship.

---

# What success looks like

A customer should eventually be able to say:

> We want to buy a house.

> We've just had a baby.

> I need to get my finances under control.

> I want to retire at 60.

> I have €50,000 sitting in cash and don't know what to do with it.

> We're separating and need to sort everything out.

And instead of forcing them to understand the organisation chart of the bank, Saoirse can respond:

> **Tell me what's happening. We'll work through it.**

---

# Why now?

For decades, truly personal relationship banking did not scale.

A human relationship manager can only serve so many people.

Digital channels solved scale by replacing relationships with self-service.

That trade-off made economic sense.

AI changes the equation.

For the first time, we can plausibly combine:

> **the scale of digital banking**

with:

> **the continuity of relationship banking.**

That is the opportunity we're exploring.

---

# The ambition

This project started with a question:

> Can we make applying for several banking products conversationally?

It has become a bigger one:

# **Can we create a new retail banking service model?**

One where the bank doesn't just remember accounts and transactions.

It remembers:

> **what the customer is trying to achieve.**

One where the digital experience doesn't simply wait for the customer to return.

It knows:

> **when the next useful moment is.**

One where AI isn't there to entertain the customer or increase engagement.

It's there to do the work.

---

# Our product principles

1. **Need first. Product second.**
2. **Goals belong to customers. Products serve those goals.**
3. **Ask once where possible.**
4. **Customer agency always wins.**
5. **Relevant does not mean relevant right now.**
6. **AI understands and communicates. Deterministic systems control banking state.**
7. **Do not manufacture engagement. Contact customers when there is something useful to do.**
8. **A human handoff should continue the relationship, not restart it.**
9. **Optimise for progress towards customer goals, not products per customer.**
10. **The best banking experience should often feel like the bank simply remembered.**

---

# In one sentence

> **Saoirse is a persistent AI relationship manager that understands what a customer is trying to achieve, builds a plan with them, coordinates the bank around that plan, performs the digital administration, and stays with them until they get where they're going.**

---

# And ultimately

We don't think the future of banking is customers spending more time inside banking apps.

We think it is the opposite.

The best bank should quietly understand what matters, do as much of the work as possible, and appear at exactly the moments when the customer needs it.

# **A personal banker for everyone.**

That's Saoirse.

## Licence

Saoirse is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See [LICENSE](LICENSE). Copyright (C) 2026 Chris Quinn. Demo Bank is a fictional bank; all customer data and figures are synthetic.
