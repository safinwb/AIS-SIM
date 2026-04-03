# AIS Simulator Requirements

## 1. Purpose

Build a desktop AIS simulator in Electron that lets an operator place and edit vessels on a Leaflet map, simulate vessel movement over time, and transmit AIS data over UDP in a format consumable by downstream marine/navigation systems.

This document defines the first implementation scope. It is intended to align UI behavior, simulation rules, and AIS message output before coding begins.

## 2. High-Level Goals

- Provide an interactive map for creating and managing simulated vessels.
- Allow each vessel to be configured with identity, position, speed, heading, and navigational status.
- Continuously update vessel positions based on simulation time.
- Encode vessel state into AIS messages.
- Wrap AIS payloads in NMEA 0183 `!AIVDM` sentences and transmit them over UDP.
- Support multiple vessels transmitting concurrently at configurable intervals.

## 3. User Workflow

### 3.1 Startup

When the application starts:

- Electron launches a desktop window.
- The renderer loads a Leaflet map.
- A control panel is shown alongside the map.
- UDP transmission settings are available:
  - destination IP address
  - destination port
  - local bind port if needed
  - transmit enable/disable
- Simulation settings are available:
  - play/pause
  - simulation speed multiplier
  - global update interval

### 3.2 Creating a Vessel

The operator can:

- click on the map to place a vessel
- enter vessel metadata in a form
- save the vessel into the scenario

Minimum vessel properties:

- MMSI
- vessel name
- AIS class
- latitude
- longitude
- SOG (speed over ground, knots)
- COG (course over ground, degrees true)
- heading (degrees true)
- navigational status

Optional first-phase properties:

- IMO number
- callsign
- vessel type
- dimension to bow/stern/port/starboard
- draft
- destination
- ETA
- rate of turn

### 3.3 Editing a Vessel

The operator can:

- select a vessel marker on the map
- drag it to a new position
- update speed, heading, and metadata
- enable or disable transmission for that vessel
- delete the vessel

### 3.4 Running the Simulation

While simulation is running:

- each vessel position is recomputed on every simulation tick
- the map marker is updated
- AIS transmission is emitted at the configured cadence
- a transmit log shows recent UDP output and vessel/message identifiers

## 4. Functional Requirements

### 4.1 Map and Vessel Interaction

- The map shall use Leaflet.
- The operator shall be able to add a vessel by clicking the map or using an add-vessel mode.
- Each vessel shall be represented by a marker or rotated icon.
- Vessel heading should be visually indicated.
- Selecting a vessel shall open an edit panel or popup with its current properties.
- The system shall support at least 100 simultaneously simulated vessels in the first version without major UI lag.

### 4.2 Simulation Engine

- The simulator shall maintain vessel state in a central model.
- The engine shall advance vessels using elapsed simulation time.
- Position updates shall use current SOG and COG.
- If SOG is zero, the vessel shall remain stationary.
- Heading and COG may differ.
- The engine shall support pause, resume, and speed multiplier.

Recommended first-phase movement model:

- use great-circle or local geodesic approximation
- update latitude/longitude from:
  - distance traveled = SOG * elapsed time
  - bearing = COG

### 4.3 Scenario Management

First phase should support:

- creating a scenario in memory
- exporting scenario JSON
- importing scenario JSON

Scenario JSON should contain:

- app version
- simulation settings
- UDP settings except secrets
- full vessel list

### 4.4 UDP Transmission

- The main Electron process shall own the UDP socket.
- The renderer shall never access raw UDP directly.
- Renderer-to-main communication shall use Electron IPC.
- AIS messages shall be transmitted as UTF-8 text lines over UDP.
- Each UDP datagram may contain one NMEA sentence in phase 1.
- Transmit errors shall be surfaced to the UI log.

UDP configuration:

- destination host/IP
- destination port
- optional local bind port
- channel code (`A` by default)
- talker sentence type (`!AIVDM` in phase 1)

## 5. Non-Functional Requirements

- The app shall run locally with no cloud dependency.
- The UI shall remain responsive during transmission.
- Vessel edits shall take effect on the next simulation tick.
- The codebase shall separate concerns:
  - renderer UI
  - simulation state
  - AIS encoding
  - UDP transport
- AIS encoding shall be deterministic and unit-testable.

## 6. System Architecture

### 6.1 Renderer Process

Responsibilities:

- Leaflet map rendering
- vessel CRUD interactions
- simulation controls
- transmission log display
- IPC calls to the main process

### 6.2 Main Process

Responsibilities:

- app lifecycle
- UDP socket creation and management
- persistence helpers if added
- receiving encoded AIS/NMEA strings from renderer or a shared service

### 6.3 Shared Domain Modules

Recommended modules:

- `scenarioStore`
- `simulationEngine`
- `aisEncoder`
- `nmeaEncoder`
- `udpTransport`
- `validation`

## 7. AIS Output Definition

### 7.1 Output Strategy

The simulator should generate AIS binary payloads, convert them into 6-bit ASCII armoring, wrap them in NMEA 0183 `!AIVDM` sentences, and send those sentences over UDP.

Phase 1 supported AIS message types:

- Message Type 1: Position Report Class A
- Message Type 2: Position Report Class A
- Message Type 3: Position Report Class A
- Message Type 5: Static and Voyage Related Data

Recommended simplification for phase 1:

- Use Message Type 1 for all dynamic Class A position reports.
- Use Message Type 5 on creation and then periodically every 6 minutes.
- Reserve support for Class B later unless needed immediately.

### 7.2 Transport Format

Each UDP payload should be one complete NMEA AIS sentence, for example:

```text
!AIVDM,1,1,,A,<payload>,<fillBits>*<checksum>
```

Field meaning:

- `!AIVDM`: AIS VHF data-link message
- `1`: total number of fragments
- `1`: current fragment number
- empty sequential message ID for single-fragment messages
- `A`: radio channel
- `<payload>`: 6-bit armored AIS payload
- `<fillBits>`: number of unused bits added to complete the last 6-bit character
- `*<checksum>`: NMEA XOR checksum

For oversized payloads such as Message Type 5, fragmentation may be required:

```text
!AIVDM,2,1,1,A,<payload-part-1>,0*hh
!AIVDM,2,2,1,A,<payload-part-2>,2*hh
```

Phase 1 requirement:

- implement correct sentence fragmentation for message types that exceed one sentence

### 7.3 Vessel State to AIS Mapping

Per vessel, the simulator should maintain:

- `mmsi`
- `navStatus`
- `rot`
- `sog`
- `positionAccuracy`
- `longitude`
- `latitude`
- `cog`
- `trueHeading`
- `timestampSecond`
- `imo`
- `callsign`
- `name`
- `shipType`
- `dimensionToBow`
- `dimensionToStern`
- `dimensionToPort`
- `dimensionToStarboard`
- `epfdType`
- `etaMonth`
- `etaDay`
- `etaHour`
- `etaMinute`
- `draft`
- `destination`
- `dte`

## 8. AIS Message Structures

The tables below define the bit-level structure the encoder should implement.

### 8.1 Message Type 1/2/3: Class A Position Report

Use this for dynamic position updates.

| Bits | Field | Size | Notes |
| --- | --- | ---: | --- |
| 1-6 | messageType | 6 | `1`, `2`, or `3` |
| 7-8 | repeatIndicator | 2 | normally `0` |
| 9-38 | MMSI | 30 | vessel identifier |
| 39-42 | navigationalStatus | 4 | e.g. underway, at anchor |
| 43-50 | rateOfTurn | 8 | signed AIS ROT encoding |
| 51-60 | speedOverGround | 10 | knots x 10, `1023` = not available |
| 61 | positionAccuracy | 1 | GNSS accuracy flag |
| 62-89 | longitude | 28 | minutes / 10000, signed |
| 90-116 | latitude | 27 | minutes / 10000, signed |
| 117-128 | courseOverGround | 12 | degrees x 10, `3600` = not available |
| 129-137 | trueHeading | 9 | degrees, `511` = not available |
| 138-143 | timestamp | 6 | UTC second |
| 144-145 | maneuverIndicator | 2 | usually `0` |
| 146-148 | spare | 3 | `0` |
| 149 | RAIM flag | 1 | `0` in phase 1 unless modeled |
| 150-168 | radioStatus | 19 | default static value in phase 1 |

Encoding notes:

- longitude and latitude use signed two's complement
- longitude unit is 1/10000 minute
- latitude unit is 1/10000 minute
- SOG is encoded in 0.1 knot resolution
- COG is encoded in 0.1 degree resolution

### 8.2 Message Type 5: Static and Voyage Related Data

Use this for vessel identity and voyage details.

| Bits | Field | Size | Notes |
| --- | --- | ---: | --- |
| 1-6 | messageType | 6 | `5` |
| 7-8 | repeatIndicator | 2 | normally `0` |
| 9-38 | MMSI | 30 | vessel identifier |
| 39-40 | AIS version | 2 | use `0` unless configured |
| 41-70 | IMO number | 30 | `0` if unavailable |
| 71-112 | callsign | 42 | 7 chars, 6-bit text |
| 113-232 | vessel name | 120 | 20 chars, 6-bit text |
| 233-240 | ship/cargo type | 8 | AIS ship type code |
| 241-249 | dimension to bow | 9 | meters |
| 250-258 | dimension to stern | 9 | meters |
| 259-264 | dimension to port | 6 | meters |
| 265-270 | dimension to starboard | 6 | meters |
| 271-274 | EPFD type | 4 | GNSS type |
| 275-278 | ETA month | 4 | `0` if unknown |
| 279-283 | ETA day | 5 | `0` if unknown |
| 284-288 | ETA hour | 5 | `24` if unknown |
| 289-294 | ETA minute | 6 | `60` if unknown |
| 295-302 | draft | 8 | meters x 10 |
| 303-422 | destination | 120 | 20 chars, 6-bit text |
| 423 | DTE | 1 | `0` ready, `1` not ready |
| 424 | spare | 1 | `0` |

Encoding notes:

- text fields use AIS 6-bit character encoding
- fixed-width text fields must be padded with `@` / zero-value characters
- message type 5 usually requires multi-fragment NMEA wrapping

## 9. Recommended Navigational Status Values

Minimum supported statuses:

- `0`: under way using engine
- `1`: at anchor
- `5`: moored
- `8`: under way sailing
- `15`: undefined

## 10. Transmission Cadence

Phase 1 simplified cadence:

- dynamic Message Type 1 every 2 seconds while simulation is running
- static Message Type 5 on vessel creation/update
- static Message Type 5 every 6 minutes thereafter

Future refinement can align update rate with official AIS behavior by speed and maneuvering state.

## 11. Validation Rules

- MMSI must be a 9-digit numeric identifier.
- Latitude must be between `-90` and `90`.
- Longitude must be between `-180` and `180`.
- SOG must be `>= 0`.
- COG must be `0-359.9`.
- Heading must be `0-359` or `511` for unavailable.
- Vessel name should be limited to 20 AIS text characters in Message Type 5.
- Callsign should be limited to 7 AIS text characters.
- Destination should be limited to 20 AIS text characters.

## 12. Phase 1 Acceptance Criteria

- Operator can add, edit, and remove vessels on a Leaflet map.
- Operator can start and pause simulation.
- Vessel positions update from configured speed and course.
- AIS dynamic reports are encoded into valid `!AIVDM` NMEA sentences.
- Message Type 5 is fragmented correctly when required.
- UDP transmission can be directed to a chosen host and port.
- A receiver listening on UDP can parse the simulator output as AIS/NMEA data.
- Scenario data can be exported and reloaded.

## 13. Open Decisions For Next Step

These should be confirmed before implementation starts:

- Should phase 1 support only Class A, or Class B as well?
- Do we need per-vessel custom transmission intervals?
- Should dragged vessels keep their existing speed/course or reset to zero?
- Should the app transmit simulated own-ship data as `!AIVDO`, or only target reports as `!AIVDM`?
- Do we want vessel track lines and waypoint routes in the first UI version?
