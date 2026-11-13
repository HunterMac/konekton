# Konekton web version

I want to be able to run konekton as standalone web app.
For fast testing purposes, we need web version of the extension as standalone app run with with
`npm run dev`

This may be standalone app later using some web data storage.

## Foundation
- uses node
- uses simple setup like vite to run web server

## Main features

**Must have** _(v1 is useless without these)_
- runs web server `npm run dev` - as standalone app
- has best apporach like adapters to imitate 

**Later** _(nice, not now)_
- Files references 

**Do not implement**
-

## Tech and Rules
- create adapter (or bettern pattern) for VSC functionalitites used - to easily replace them with standalone web features
- Files references - May be out of scope as this does not make much sense on the web

