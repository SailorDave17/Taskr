# Which retailer APIs expose per-store aisle location — #362

## Metadata

- **Spike date and fetch date for every cell:** 2026-09-06. A cell's date is the day its URL was
  read; nothing here was carried from memory or from an earlier document.
- **Time box:** one engineer-day (epic #349, owner decision 2026-09-05). Spent in one session.
- **Repo at:** `9be5792` (`develop`). No product code changed; the diff is this file and one README line.
- **Instruments:** page fetches, web search, and — for three portals that render **nothing without
  JavaScript** (`developer.kroger.com`, `walmart.io`, `developer.target.com`) — a scripted Chrome
  session that waited for the page to render and read its text. A plain fetch of any of those three
  returns an empty body, which reads exactly like *no documentation exists*; it does not. Kroger's
  OpenAPI specifications were downloaded from the rendered reference pages and the schema below is
  quoted from the JSON, not from prose.
- **Per-cell provenance**, following cairn's `a-measurement-table-can-hold-an-inference`: every cell
  is one of *measured* (read off the cited page on the date), *reasoned* (derived from measured
  cells, and says so), or **unanswered** (with what was tried and, where a credential would answer
  it, which credential — that half is #363). A cell that carries a *because* is an inference and is
  marked as one.

## The headline

| Retailer | Public developer programme, individuals admitted | Aisle location in the product response, per store | Verdict | Deciding cell |
|---|---|---|---|---|
| **Kroger** (and its 24 banners) | Yes — free, self-service, anyone of legal age | **Yes** — `aisleLocations[]` with aisle, side, bay, shelf and walk-order sequence, keyed on `filter.locationId` | **go**, conditional on #363's one real lookup | Products API schema, `products.productAisleLocationModel` |
| **Walmart** | Affiliates only; licence is *advertising Walmart.com products online* | **No** — the full item response group has no aisle, shelf or in-store position field | **no** | Item Response Groups, Full Response field list |
| **Target** | No — portal is a login wall to Partners Online, restricted to employees and existing business partners | Only through an unofficial internal endpoint that Target's site terms prohibit a tool from calling | **no** | `developer.target.com` (login only) and target.com Terms & Conditions |
| Instacart *(in passing)* | Yes — self-service key, production behind approval | **No** — the only product endpoint returns a URL | no | `POST /idp/v1/products/products_link` response |
| Albertsons, Meijer, H-E-B, Publix, Whole Foods *(in passing)* | None found | — | no | search only, see below |

**Recommended phase verdict: proceed with a named retailer — Kroger.** Not *kill*: one retailer
exposes aisle location to an individual developer, in its public documentation, at no cost, and at
a granularity finer than the stretch needs. Not *wait on #363*: the credential does not decide
whether the field exists — the public schema already does — it decides whether the field comes back
**populated for the household's own store**, which is #363's third criterion and the one thing this
spike could not observe. The go is conditional on exactly that, and the condition is named in the
Kroger section below. The owner's ruling is theirs to record as a dated line on #349; filing or
dropping the four held stretch stories follows that ruling and not this paragraph.

---

## Kroger

Every URL below was read on 2026-09-06. The developer portal is `developer.kroger.com`; the API is
`api.kroger.com`.

| Cell | Reading | Provenance |
|---|---|---|
| Public developer programme | Yes. Landing page: *"APIs for Everyone — Build something amazing with our free Public APIs"*; *"Joining our growing community is easy and free. Register your application to obtain a client id and secret and begin making API requests right away."* Four public APIs: Products, Locations, Cart, Identity. A separate **Partner** tier *"is limited to specific use cases and requires a contractual agreement with Kroger"* (FAQ). | *measured* — [developer.kroger.com](https://developer.kroger.com/), [FAQ](https://developer.kroger.com/support/faq) |
| Individual developers admitted | Yes. Quick Start: *"Public APIs are available for all clients"*; steps are create an account (email verification), register an application, make a test call. Terms §1a admit anyone *"of legal age to form a binding contract"*; §1b covers entities as an option, not a requirement. No company, website or business-purpose question is asked in the documented flow. | *measured* — [Quick Start](https://developer.kroger.com/documentation/public/getting-started/quick-start), [Terms of Service](https://developer.kroger.com/terms) (last modified 2019-04-09) |
| How a store is identified | An 8-character `locationId`, found through the **Locations API**: `GET /v1/locations` with one of `filter.zipCode.near`, `filter.latLong.near`, or `filter.lat.near` + `filter.lon.near`; `filter.radiusInMiles` 1–100, default 10; `filter.limit` up to 200; `filter.chain` narrows to one banner (e.g. `Kroger`, `Ralphs`, `Fred Meyer`). `GET /v1/chains` lists the banners. FAQ: *"the Locations API does not support city or state parameters."* | *measured* — Location API spec v1 (downloaded from the [reference page](https://developer.kroger.com/api-products/api/location-api-public)), [Locations overview](https://developer.kroger.com/documentation/api-products/public/locations/overview) |
| Product search / lookup endpoint | `GET /v1/products` with an initial value of `filter.term` (≥3 characters, ≤8 words, fuzzy, *"non-personalized results based on popularity, so the results may vary from request to request"*) **or** `filter.productId` (13 digits, *"For more than one item, the list must be comma-separated"*, up to 50 — an exact match, other filters ignored) **or** `filter.brand`; plus `filter.locationId` (8 characters). `GET /v1/products/{id}` for one product. Default page 10, `filter.limit`/`filter.start`. | *measured* — Products API spec v1.3.0 (downloaded from the [reference page](https://developer.kroger.com/api-products/api/product-api-public)), [Products overview](https://developer.kroger.com/documentation/api-products/public/products/overview) |
| Response shape | Documented schema, quoted from the spec: `products.productAisleLocationModel` — `bayNumber` *"The bay number of the aisle"* (example `"13"`), `description` *"The location in the store"* (example `"Aisle 35"`), `number` *"The aisle number in the store"* (`"35"`), `numberOfFacings` (`"5"`), `sequenceNumber` *"The sequence of the aisle in the store"* (`"3"`), `side` *"The side of the aisle where the product is located"* (`"L"`), `shelfNumber` *"The shelf number in the aisle"* (`"2"`), `shelfPositionInBay` (`"1"`). All strings. Each product carries `aisleLocations: [...]` beside `productId`, `upc`, `description`, `brand`, `categories`, `items[].price`, `items[].fulfillment`, `items[].inventory.stockLevel`. A recorded real response (third-party client library, undated) shows the same fields with two entries for one milk: `{"bayNumber":"20","description":"Dairy","number":"100","numberOfFacings":"6","sequenceNumber":"4","side":"L","shelfNumber":"4","shelfPositionInBay":"1"}` and a second bay `"21"`. | *measured* — spec JSON; [python-kroger-client `products.json`](https://github.com/jtbricker/python-kroger-client/blob/master/docs/api_responses/products.json) for the recorded response |
| Aisle or shelf field, and granularity, PER STORE | **Yes, per store.** Overview: *"To return the following data from the `/products` endpoint, you must include a location Id in the request … Aisle Locations — Returns the aisle locations of the item for the given location."* Granularity: aisle number and a human description, side, bay, shelf, shelf position, facings, **and `sequenceNumber`, the aisle's order along the store's walk** — the sort key the held *order the unbought items by aisle* story would want. FAQ caveat: *"this indicates that the item has a dedicated location in the store at that point in time … does not indicate that the item has been stocked or is available"* — so an aisle can come back for a sold-out item, and `stockLevel` is the separate answer. | *measured* — [Products overview](https://developer.kroger.com/documentation/api-products/public/products/overview), [FAQ](https://developer.kroger.com/support/faq) *"What does aisle location tell me?"* |
| Auth model | OAuth2 **client credentials**: `POST https://api.kroger.com/v1/connect/oauth2/token` with `Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)` and `grant_type=client_credentials`; the Products API declares scope `product.compact`, the Locations API needs none. Authorization-code flow exists only for Cart and Identity (a customer's own Kroger account) and is not needed here. Two environments, registered separately: production `https://api.kroger.com/v1/` and certification `https://api-ce.kroger.com/v1/`, of which the docs say *"do not rely on it for complete and accurate data."* | *measured* — [Quick Start](https://developer.kroger.com/documentation/public/getting-started/quick-start), [API Basics](https://developer.kroger.com/documentation/public/getting-started/apis), spec `security` blocks |
| Rate limits | Products **10,000 calls per day**; Locations **1,600 calls per day per endpoint** (three endpoints: locations, chains, departments); Cart 5,000; Identity 5,000. *"we enforce the rate limit by the number of calls the client makes to the endpoint, not individual API operations"*; *"Rate limits reset 24 hours after the first call to an endpoint"*; a `429` means the daily limit is reached. The limit is per registered client — i.e. per Taskr deployment, shared by every household on it — *"we do not currently support individual rate limits by client"* means no per-client raise, not per-user limits. Beyond it: *"you must obtain Kroger's express consent (and Kroger may decline such request or condition acceptance on … charges for that use)"*. | *measured* — [FAQ](https://developer.kroger.com/support/faq) *"What are the rate limits for Public APIs?"*, [API Basics](https://developer.kroger.com/documentation/public/getting-started/apis), Terms §2d |
| Free-tier pricing | Free. No paid tier is published for Public APIs; the only path past the limits is the Partner request above. | *measured* — landing page, FAQ |
| Terms' stance on a non-commercial household app | **No clause distinguishes commercial from non-commercial use; nothing bars a personal app.** What the terms do bind, each relevant here: (1) *"Scrape, build databases, or otherwise create permanent copies of such content, or keep cached copies longer than permitted by the cache header"* is prohibited (§5e) — an aisle result may be cached only as long as the response's cache header allows, not stored in `shopping_items`; (2) Acceptable Use prohibits *"Comparing products/prices among other retailers"* and *"Tracking, sharing, or storing data derived from customer searches"*; (3) *"Displaying product data exactly as it is returned"* — no shortening a description; (4) the app name *"Cannot have Kroger anywhere in the name"*; (5) an API Client must *"provide and adhere to a privacy policy"* describing what it collects (§3d) — Taskr already publishes one for the calendar integration; (6) *"Developer credentials may not be embedded in open source projects"* (§4b) — this repository is public, so the secret lives only in the Edge Function; (7) the integration logo is *encouraged*, the primary banner logos are restricted to an add-to-cart use. | *measured* — [Terms of Service](https://developer.kroger.com/terms), [Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use), [Branding Guidelines](https://developer.kroger.com/documentation/public/getting-started/branding) (2021-04-28) |

### Server-side call, and the Edge call volume (AC 2)

**A server-side call is required — yes.** Two independent reasons, either sufficient: the token is
minted from a client *secret*, and `docs/hosting-decision.md` rejects *"a client-side provider key"*
by name because *"a secret in the bundle is public"*; and Kroger's Terms §4b forbid the credential in
an open-source project, which this repository is. So the shape is the calendar precedent — an Edge
Function holds `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET`, mints a `client_credentials` token
(expiry not read here; it is an OAuth2 `expires_in` and #363's first real call records it), and
proxies `/v1/locations` and `/v1/products` for a signed-in member. The `aisle-lookup` Edge Function
the epic holds as a proposal is the right unit.

**Metering — per call to the `/products` endpoint, not per product.** Kroger counts *"the number of
calls the client makes to the endpoint"*, and a `filter.productId` call carries up to fifty ids
(*measured*, spec `<= 50`). So **per-arrival batching is affordable once an item is matched to a
`productId`**: fifty items in one call, one call per tab arrival. A free-text `filter.term` search is
one term per call and cannot be batched, so the first match of each household item name costs one
call.

**Volume per shopping run** *(reasoned from the measured cells; nothing below is a measurement)*:

| Step | Kroger calls | Edge invocations |
|---|---|---|
| Pick the store (once per run, or never after the first run if the store is remembered on the run) | 1 × `/v1/locations` by zip or lat/long | 1 |
| First arrival on the Shop tab with *N* unmatched free-text items | *N* × `/v1/products?filter.term=…&filter.locationId=…` | 1 (the function can fan out server-side) or *N* |
| Each later arrival, items already matched to `productId`s | ⌈*N*/50⌉ × `/v1/products?filter.productId=…` | 1 |
| A new item added mid-trip | 1 | 1 |

For a household run of **20 items and 4 tab arrivals** that is roughly **20 + 3 + 1 = 24 Kroger
calls** and **4–24 Edge invocations** per run, depending on whether the term searches fan out inside
one invocation. At two runs a week that is ~200 Kroger calls and at most ~200 Edge invocations per
household per month. Against the Edge free tier of **500,000 invocations per month**
(`docs/hosting-decision.md`), ~0.04% per household. Against Kroger's **10,000 per day per client**,
24 calls a run allows ~400 runs a day across every household on the deployment before a `429`;
Locations at 1,600 a day is one store pick per run and is not the binding number. **The binding
cap is Kroger's daily one, and it is shared across the deployment, not per household** — a fact the
held *aisle-lookup* story should carry as a criterion (a `429` must degrade to *no aisle shown*, never
to a blocked list).

One design consequence follows from §5e rather than from the numbers: the `productId` an item was
matched to is *content returned from the API*, and a permanent copy of it on `shopping_items` is
what the clause prohibits. Holding the match for the life of the open run in memory, or for the
cache-header window, is inside the terms; writing it to the database is a question for the owner
at the story's pickup, and the conservative reading is not to.

### Unanswered, and which credential answers it (→ #363)

| Question | What was tried | What answers it |
|---|---|---|
| Does a real store near the household return **populated** `aisleLocations`? The overview says the field is returned *"when available"*, and the certification environment is documented as unreliable data. | Read only; no credential in this session. | One `client_credentials` lookup against **one production `locationId`** for a Kroger-banner store the household actually shops — #363 AC 3. This is the go's condition. |
| The `cache-control` value on a `/products` response — which sets how long an aisle may be held (§5e). | Not observable without a call. | The same lookup; record the header beside the redacted body. |
| Access-token lifetime (`expires_in`). | Not stated in the docs read. | The token call in the same session. |
| Whether the fuzzy `filter.term` search puts a household's usual item first for plain words (*milk*, *eggs*) at the household's store — which decides whether the held story can take the first hit or must ask the shopper. | Not observable without a call; the FAQ warns results *"may vary from request to request"*. | Ten representative terms against the same `locationId`, recorded once — #363 can carry it as a fourth observation or the held story can. |
| **Is there a Kroger-family banner within the household's shopping radius at all?** The API can only place items in stores The Kroger Co. owns. | Not a fact this session holds. | The owner, from `kroger.com`'s store locator or by knowing where they shop — no credential needed. Listed under *What the owner must do*. |

---

## Walmart

Every URL below was read on 2026-09-06. The developer portal is `walmart.io`; the API host is
`developer.api.walmart.com`.

| Cell | Reading | Provenance |
|---|---|---|
| Public developer programme | There is a portal (*"Walmart I/O hosts the Walmart APIs that allow developers to build with the world's largest retailer"*) whose onboarding page says it *"is focused on Affiliates and third party Developers"* and asks you to *"choose the Affiliate path or the Developer path"*. The product-data API is the **Affiliate Marketing API**; its own introduction says it exists *"to earn referral fees by creating apps that help users to find and purchase products on Walmart.com."* | *measured* — [walmart.io](https://walmart.io/), [onboarding](https://walmart.io/onboarding), [Affiliates API introduction](https://walmart.io/docs/affiliates/v1/introduction) |
| Individual developers admitted | Only as **affiliates**. The API terms open: *"The Walmart API is available to Walmart's affiliate partners solely for the purpose of advertising Walmart.com products online. It may not be used for any other purposes without express written permission from Walmart."* Affiliate eligibility: 18+, not a Walmart employee, an application *"reviewed carefully"* at Walmart's discretion, tracked through Impact (*"Walmart.com uses Impact Radius as our Affiliate Service Provider"*). Every product URL takes a `publisherId` — *"Your Impact Radius Publisher Id"*. | *measured* — [Walmart I/O Terms of Use](https://walmart.io/termsandcondition) (last updated 2020-09-30), [affiliate FAQ](https://affiliates.walmart.com/page/faqs), [affiliate agreement](https://affiliates.walmart.com/terms) |
| How a store is identified | **Stores API**: `GET …/affil/product/v2/stores?lat=…&lon=…` or `?zip=…`, returning `no` (store number, e.g. `2066`), `name`, `coordinates`, `streetAddress`, `city`, `stateProvCode`, `zip`, `phoneNumber`. | *measured* — [Stores](https://walmart.io/docs/affiliates/v1/stores) |
| Product search / lookup endpoint | **Product Lookup**: `GET …/affil/product/v2/items/{itemId}` or `?upc=` / `?gtin=` / `?ids=` (up to 20), with `zipCode`; *"Price and availability is also dependent on zipCode and storeId"* — but `storeId` *"needs additional approvals from business team"*. **Search**: `GET …/affil/product/v2/search?query=…`, *"returns matching items available for sale online"*, 25 per page, top 1,000. | *measured* — [Product Lookup](https://walmart.io/docs/affiliates/v1/product-lookup), [Search](https://walmart.io/docs/affiliates/v1/search) |
| Response shape | The **Full Response** group (used by Product Lookup) is a documented field list: `itemId`, `parentItemId`, `name`, `msrp`, `salePrice`, `upc`, `categoryPath`, `shortDescription`, `longDescription`, `brandName`, images, `productTrackingUrl`, shipping rates, `size`, `color`, `marketplace`, `sellerInfo`, `shipToStore`, `freeShipToStore`, `modelNumber`, `availableOnline`, `stock` (*"Indicative quantity of the item available online"*), ratings, `clearance`, `preOrder`, **`offerType`** (*"ONLINE_ONLY, ONLINE_AND_STORE, STORE_ONLY"*), `rhid`, `bundle`, `attributes`, `affiliateAddToCartUrl`, `gender`, `age`, `imageEntities`, gift options, `bestMarketplacePrice`, `variants`, installment fields. | *measured* — [Item Response Groups](https://walmart.io/docs/affiliates/v1/item-response-groups) |
| Aisle or shelf field, PER STORE | **No.** Neither response group carries an aisle, shelf, bay, section or in-store position field; the nearest is `offerType`, which says whether a product is sold in stores at all, and `shipToStore`. Store-level anything sits behind the `storeId` parameter and its *"additional approvals from business team"*, and even that parameter is documented for price and availability only. | *measured* — same page; the field list was read in full |
| Auth model | Request signing: headers `WM_CONSUMER.ID` (a UUID for the application), `WM_CONSUMER.INTIMESTAMP` (epoch ms), `WM_SEC.KEY_VERSION`, and `WM_SEC.AUTH_SIGNATURE` — *"generated using the private key and signing the values of consumer id, timestamp and key version"* with `SHA256WithRSA`; *"The TTL of this signature is 180 seconds."* The onboarding page: *"Upload your public key and link it to an application."* | *measured* — [Additional Headers](https://walmart.io/docs/affiliates/v1/additional-headers), [onboarding](https://walmart.io/onboarding) |
| Rate limits | *"API calls are subject to a daily rate limit of 5000 calls per day."* Higher on request *"for valid business purposes"*. | *measured* — Terms of Use §1 |
| Free-tier pricing | Free to the affiliate; the relationship is paid the other way (commissions on referred sales). | *measured* — Terms of Use §2, affiliate FAQ *"It is absolutely free to join"* |
| Terms' stance on a non-commercial household app | **Outside the licence.** The API is for *"advertising Walmart.com products online"* and *"may not be used for any other purposes"*; the affiliate agreement lists unsuitable sites including any *"under construction or not live at the time of Application"* and requires a public privacy policy, and the terms prohibit placing links *"on any social networking sites"*. A household shopping list that shows an aisle is not advertising, so it would need *"express written permission"* — and there is no aisle to show. | *measured* — Terms of Use §1, §3 |
| Server-side call required (AC 2) | Yes, if it were used at all: the signature needs the RSA **private key**, which is the client-side-key defect exactly. | *reasoned* from the auth cell |
| Edge call volume (AC 2) | Not estimated: there is no aisle call to make. Lookups meter per call, 20 ids per call, 5,000 a day. | *reasoned* |

**Unanswered.** A third-party plugin vendor's page states *"Walmart no longer releases new API keys. If you do not have your API key, leave this field empty"* (undated; [ce-docs.keywordrush.com](https://ce-docs.keywordrush.com/modules/affiliate/walmart), read 2026-09-06), while Walmart's own onboarding page on the same day still describes uploading a public key. Which is current can only be settled by **applying as an affiliate** — not recommended, since the verdict does not depend on it: the documented response has no aisle field either way.

---

## Target

Every URL below was read on 2026-09-06.

| Cell | Reading | Provenance |
|---|---|---|
| Public developer programme | **None.** `developer.target.com` renders two controls and nothing else: *TEAM MEMBER / TARGET PLUS LOGIN* and *EXTERNAL USER LOGIN*. The external login goes to **Target Partners Online** (`logonservices.oauth.iam.partnersonline.com`, application `dev_portal_prod_im`), which states *"This website is for Target business purposes … you warrant that you are using an authorized ID and password"* and offers *Want to be a Target supplier?* as the only way in. No register, request-access or documentation link exists on either page. | *measured* — [developer.target.com](https://developer.target.com/) and the login page it redirects to |
| Individual developers admitted | **No.** The only wording of the policy found is from 2014: *"Access to the developer portal is restricted to Target employees and trusted third parties that currently have a working relationship with Target Corporation."* The portal seen today is consistent with it (a login wall behind a supplier-onboarding link). | *measured* for today's portal; the quoted sentence is from [API Evangelist, 2014-10-09](https://apievangelist.com/2014/10/09/the-publicly-available-private-target-apis/) — an old source, and the only one that states the rule in words |
| How a store is identified | Unknown for the partner API (behind the login). The unofficial endpoint below takes a numeric `store_id`. | **unanswered** — partner login |
| Product search / lookup endpoint | Unknown for the partner API. **Unofficial:** `redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1?key=…&tcin=…&store_id=…&pricing_store_id=…` — the endpoint `target.com`'s own pages call, with a key *"hardcoded in"* the site's JavaScript. | *measured* — [community gist](https://gist.github.com/LumaDevelopment/f2a34a202fed6ab5a7f3a31282834943) describing the endpoint; the endpoint was **not** called from this session |
| Response shape | Unofficial response, as recorded in that gist: a store-options object carrying `"aisle": 40, "block": "C"`, `availability_status`, `location_available_to_promise_quantity`, plus store name, address and id. | *measured* from the gist, not from a call |
| Aisle or shelf field, PER STORE | **Officially unknown; unofficially yes** (`aisle` + `block`, per `store_id`). Whether Target's *partner* API carries the same field is exactly what a partner credential would answer, and #363 cannot obtain one — Partners Online admits suppliers and vendors, not developers. | **unanswered** for the official API — credential: a Target supplier / Target Plus partner account, which is a business relationship rather than an application |
| Auth model | Partner: OAuth2 through Partners Online (`oauth.iam.partnersonline.com`, seen in the redirect). Unofficial: a static `key` plus a `visitor_id`, both scraped from the site. | *measured* (redirect URL); gist |
| Rate limits, pricing | Unknown. The gist's later comments report *"the API seems to have become more closed off recently"* with IP blocking after a low number of requests. | **unanswered** — partner login |
| Terms' stance | **Prohibitive for the unofficial route.** target.com Terms & Conditions grant *"a limited license to access and make personal use of the Site and the Content for NONCOMMERCIAL PURPOSES ONLY"* — which a household app satisfies — but in the same document prohibit using *"any engine, software, tool, agent, data or other device or mechanism (including browsers, spiders, robots, avatars or intelligent agents) to navigate or search the Site other than the search engine and search agents provided by Target, generally publicly available browsers, or approved Agentic Commerce Agents"* and *"any use of data extraction, scraping, mining or other data gathering tools"*. An Edge Function calling Redsky is a tool navigating the site. The *approved Agentic Commerce Agents* carve-out was searched for and no programme, application or list of approved agents was found on 2026-09-06 (industry coverage places Target in the Universal Commerce Protocol launch, which is a checkout protocol, not a product-data API). | *measured* — [target.com Terms & Conditions](https://www.target.com/c/terms-conditions/-/N-4sr7l), read 2026-09-06 |
| Server-side call required (AC 2) | Moot: no permitted call exists. | — |
| Edge call volume (AC 2) | Not estimated. | — |

---

## Found in passing

### Instacart Developer Platform

| Cell | Reading | Provenance (read 2026-09-06) |
|---|---|---|
| Programme, individuals | Self-service: *"Get an API key"* from a developer dashboard; production key behind a review requiring *"100% compliance with Instacart Developer Platform terms & conditions"*, correct request formatting, error handling and an *Enterprise Help Desk account*. Terms (2024-07-03) admit an *"individual or entity"*; no commercial/non-commercial clause. | *measured* — [introduction](https://docs.instacart.com/developer_platform_api/), [approval process](https://docs.instacart.com/developer_platform_api/guide/concepts/launch_activities/approval_process), [terms](https://docs.instacart.com/developer_platform_api/guide/terms_and_policies/developer_terms/) |
| Store identification | `GET /idp/v1/retailers?postal_code=…&country_code=US` returns `retailer_key`, `name`, `retailer_logo_url` — *"a retailer as a whole organization"*, not a store. | *measured* — [get nearby retailers](https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers/) |
| Product endpoint and shape | `POST /idp/v1/products/products_link` takes `line_items[]` (`name`, `quantity`, `unit`, `upcs`, `product_ids`) and returns **only** `products_link_url`, a page on Instacart where the user picks a store and fills a cart. No product match, price, availability or location comes back to the caller. | *measured* — [create shopping list page](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page) |
| Aisle field | **No.** | *measured* |
| Auth, limits, price | Bearer API key; *"a limited number of requests per second"* with `429` on excess, figure unpublished; no price published — public reporting says partner terms. | *measured* — [API overview](https://docs.instacart.com/developer_platform_api/api/overview/) |
| Verdict | **no** — deciding cell: the product endpoint returns a URL. Instacart is a hand-off to Instacart, not a data source. | |

### Others

Search-level only (one query each, 2026-09-06); none was worth a page fetch because none surfaced a
developer portal for product data:

- **Albertsons / Safeway** — publishes retail-media APIs (Audiences, Campaigns, Performance) for
  advertisers; no product or store API for developers found. *unanswered beyond search.*
- **Meijer, H-E-B, Publix, Whole Foods** — no public developer API found; every hit was a
  third-party scraper. *unanswered beyond search.*
- **AisleFinder "Supermarket API"** (2011 press coverage claiming aisle data for Whole Foods, Trader
  Joe's, Safeway, Costco, Walmart) — `supermarketapi.com` answered **403** on 2026-09-06. Treated as
  dead; not a source.

---

## Verdicts (AC 4)

| Retailer | Verdict | The cell that decided it |
|---|---|---|
| Kroger | **go** — conditional on #363 AC 3 returning populated `aisleLocations` for one real store the household shops | *Aisle or shelf field, PER STORE*: documented `products.productAisleLocationModel`, returned with `filter.locationId`, under a free public programme that admits individuals |
| Walmart | **no** | *Aisle or shelf field*: the Full Response field list has none; and the licence is advertising-only |
| Target | **no** | *Public developer programme*: none; the only aisle data is behind an unofficial endpoint the site terms forbid a tool from calling |
| Instacart | **no** | product endpoint returns a URL |

**Recommended verdict for the phase: proceed with Kroger.** Kill would be wrong — the kill
condition in the issue is *no retailer exposes aisle location to an individual developer*, and one
does, in public documentation. Waiting on #363 for the verdict would be wrong too — the credential
cannot change the schema, only confirm the data is populated at the household's store, which is the
named condition on the go. The owner records the ruling on #349 as a dated line; nothing here files
or drops a held story.

**What the four held stretch stories inherit if the ruling is Kroger** *(so they can be re-cut
against real shapes rather than the marketing page — reasoned, not a decision)*:

- *Pick the store this run is being shopped at* — the `store-locate` Edge Function is
  `GET /v1/locations` by zip or lat/long with an optional `filter.chain`; the store column holds the
  8-character `locationId`, and a `chain` or banner name for display. Locations calls are 1,600 a day.
- *Show each unbought item's aisle* — `aisle-lookup` proxies `GET /v1/products` with
  `filter.locationId`; first match by `filter.term` per item, later arrivals by `filter.productId` in
  batches of 50; items with an empty `aisleLocations` are simply absent from the map, as the held
  story already says. A `429` degrades to *no aisles*, never to a blocked list. Aisle results are
  not written to the database (Terms §5e).
- *Order the unbought items by aisle* — the sort key is `sequenceNumber` (the aisle's order along
  the walk), then `number`, then `side`/`bayNumber`/`shelfNumber`; every field is a **string** and
  must be compared numerically where it is numeric. The fallback stays byte-identical to #355's order.
- *Confirm live aisle lookup against a real store visit* — unchanged in shape; its accuracy
  threshold reads `description` and `number` against the physical aisle sign.

---

## What the owner must do (AC 5)

The #363 checklist. Nothing on it needs anything but a browser, an email address and the household's
zip code; no step is on a third party's approval clock except as noted.

**Kroger — do these.**

1. Confirm a Kroger-family banner (Kroger, Ralphs, Fred Meyer, King Soopers, Fry's, Smith's,
   Harris Teeter, Mariano's, QFC, Dillons, Baker's, City Market, Food 4 Less, Pick 'n Save, Metro
   Market, Owen's, Jay C, Pay Less, Gerbes, Roundy's, Ruler, Food Co, Copps, Home Chef — the
   twenty-four the branding page lists) is within the household's shopping radius. If none is,
   the go is moot and the phase verdict becomes *wait* — nothing else on this list is worth doing.
2. Create a developer account at `developer.kroger.com` (email verification), accepting the
   **Terms of Service** (last modified 2019-04-09), and read the **API Acceptable Use** and
   **Branding Guidelines** (2021-04-28) the FAQ names as required — the three documents in the
   *Terms' stance* cell above.
3. Register **one application in the Production environment** (the certification environment is
   documented as unreliable data and cannot discharge #363 AC 3). The name may not contain or
   resemble *Kroger*; a redirect URI is only needed for the authorization-code flow, which this
   integration does not use. Record the application **name** on #363; **the client id and secret go
   nowhere but `supabase secrets set KROGER_CLIENT_ID … KROGER_CLIENT_SECRET …`**, per #363 AC 2 —
   never an issue, a transcript or the repository. Note the FAQ's warning that the secret is shown
   once.
4. Make one real lookup (#363 AC 3): mint a token with `grant_type=client_credentials`, resolve
   the household's store with `GET /v1/locations?filter.zipCode.near=<zip>` (choose the one you
   shop; note its `locationId`), then `GET /v1/products?filter.term=milk&filter.locationId=<id>`.
   Record on this document, redacted: whether `aisleLocations` is **populated**, one entry verbatim,
   the response's `cache-control` header, the token's `expires_in`, and the fetch date. That reading
   converts the conditional go into a go, or into a no for the household's store.

**Walmart — nothing.** No developer-programme registration is recommended: the documented response
carries no aisle field and the licence excludes the use, so a credential would confirm a *no* at the
cost of an affiliate application. If the owner nonetheless wants the *"no longer releases new API
keys"* question settled, the route is an affiliate application through Impact and then the
`walmart.io` Developer path — and the verdict would not move.

**Target — nothing is available to do.** There is no registration; Partners Online is for suppliers
and Target Plus sellers. Do not use the Redsky endpoint from the app.

---

## What this spike is not

- **Not a measurement of the data.** Every Kroger cell is the *documented* shape. Whether the
  household's store returns populated aisles, how fresh they are, and how often a sold-out item still
  carries one, are #363's and the confirmation story's.
- **One day, one reader.** Each portal was read once, on one date, and portals move; Walmart's terms
  are dated 2020 and Kroger's 2019, and the Kroger FAQ is undated. Re-read the *Terms' stance* cells
  before the first story that spends a credential.
- **US only.** Kroger's Locations API covers Kroger-owned stores; the phase is only buildable for a
  household that shops one.
