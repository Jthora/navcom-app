# Notices for data seeded from Overture Maps

Rows whose id reads `<region>-overture-<hex>` were seeded from the **places** theme of
[Overture Maps Foundation](https://overturemaps.org/) data, release `2026-08-19.0` or earlier
as each region's `region.json` pins it.

Overture Maps Foundation, overturemaps.org.

Overture's places data is contributed by several organisations, and each contribution keeps its
own terms. As Overture lists them (<https://docs.overturemaps.org/attribution/>, read 2026-09-13):

| Data from | Terms |
|---|---|
| Meta, Microsoft, PinMeTo, Krick, RenderSEO, DAC, BrightQuery | CDLA Permissive 2.0 — text in [`LICENSE-CDLA-Permissive-2.0.txt`](LICENSE-CDLA-Permissive-2.0.txt) |
| Foursquare | Copyright 2024 Foursquare Labs, Inc. All rights reserved. Apache 2.0 — text in [`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt). Foursquare data was transformed to the Overture schema. Its notice is reproduced in full below |
| AllThePlaces | CC0 1.0 |

Which contributor supplied a given row is not recorded in these files, so every notice above is
kept for all of them.

## Changes NavCom made

The data was changed before it reached these files:

- Only places Overture categorises as `homeless_shelter`, `food_bank` or `soup_kitchen` were
  taken, and each was mapped to one of NavCom's own types
- Places below Overture's confidence score of 0.5, and places with no name, were left out
- Only the name, first address, first phone number, first website and position were kept
- Places that appear to be the same service were merged into one, and a place sharing a phone
  number with a row a person wrote was left out rather than combined with it
- A row a person has checked is never overwritten by a later scrape

None of this is warranted to be accurate. Call before sending anyone anywhere.

## Foursquare OS Places notice

Reproduced from <https://opensource.foursquare.com/places-notice-txt/> as read on 2026-09-13.

> © 2026 Foursquare Labs, Inc. All rights reserved.
>
> The Foursquare OS Places dataset (the "Data") is licensed under the Apache License, Version 2.0
> (the "License"). You may not use, modify, or distribute the Data except in compliance with the
> License.
>
> As set forth more fully in the License, if you use, modify, or distribute the Data, you must:
>
> – provide recipients with a copy of the License.
>
> – if applicable, include prominent notices to the extent you've changed the Data.
>
> – preserve attribution to Foursquare, including preserving the full content of this NOTICE.txt
> file.
>
> To ensure appropriate attribution to Foursquare, we recommend the following:
>
> – if using/distributing the Data in flat file form as-is or after making changes/modifications:
> include this NOTICE.txt file, which may be modified to include an additional notice of your
> changes/modifications, if any.
>
> – if using/distributing the Data in API form as-is or after making changes/modifications:
> include a copy of the content from this NOTICE.txt file prominently in your developer
> documentation for such API, which may be modified to include an additional notice of your
> changes/modifications, if any.
>
> You may obtain a copy of the License at: http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, the Data distributed under the
> License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
> either express or implied. See the License for the specific language governing permissions and
> limitations under the License.
