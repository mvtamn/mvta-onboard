# Operator Kiosk — Hardware and Device Provisioning

Date: 2026-10-31. **Not implemented. Nothing here is bought or decided**
beyond what the user has already decided (Android). Each section ends with a
recommendation for MVTA IT, Operations or Procurement to accept or change.

This takes the hardware and provisioning parts of
`plans/operator-kiosk-evaluation.md` (PR #461) deeper: its §2 (Hardware), §3.5
(Device management), the reader hardware in §3.6, and §7 steps 1–7, 10 and 19.
The evaluation's software, sign-in and API design are unchanged. Section
numbers such as "eval §3.2" refer to that file. "D7", "D18" and so on refer
to the decisions in `plans/ridership-operator-app.md` (PR #458).

**Constraints carried in, not reopened:**

- **Android** (user, 2026-10-31).
- The kiosk is an **operator platform**: ridership first, then vehicle
  condition reports with photos, detour maps and other modules (eval §8). So
  this prefers a rear camera, NFC and the larger screen.
- No hardware on buses and no MDT change (D1).
- Two kiosks per garage, plus one spare for the fleet (eval §1, §2).
- MVTA owns, enrols and patches the kiosks; the contractor has physical
  custody (eval §3.5).
- Each kiosk signs in as its own Entra **kiosk account**, allowed in by
  Conditional Access only from a compliant device, and holds the app-owned
  role `operator-kiosk` (eval §3.2, option B).

**About the figures.** Prices and specifications come from web research on
2026-10-31. Every figure carries a source number (S1 …) from the
[Sources](#sources) list at the end, which gives the URL and the date read.
Reseller prices move weekly and differ by configuration. **Get a quote for
the exact SKU before ordering.** Figures marked *estimate* are this document's
own planning figures with no source, to be replaced by quotes.

## Summary

- **Recommended tablet: Samsung Galaxy Tab Active5 Pro, Enterprise Edition,
  Wi-Fi model** (§1). It has glove mode, an NFC reader on the **front**
  (where a badge is tapped through the enclosure), a rear camera, and Samsung
  security updates for **7 years**. It costs about **$600–760** (S1, S2).
- **Alternative if 11" matters more than update life: Lenovo ThinkTab X11
  Gen 1.** It has a 10.95" screen, front NFC, two USB-C ports, and a battery
  that can be removed for fixed installs. It costs about $440–580 (S8, S9).
  But the sources disagree on its update term, between 4 and 7 years (S9,
  S11), and its screen is called dim (S8, S9). Buy it only if Lenovo
  confirms the update term in writing and confirms that it is Android
  Enterprise Recommended.
- **Premium option: Zebra ET60** (Wi-Fi). It has a 1,000-nit screen, a
  heated glove-and-rain touchscreen and confirmed Android Enterprise
  Recommended status, with Zebra updates for at least 5 years. It costs about
  $1,070–1,770 (S13–S16), so about twice the Samsung. Choose it only if the
  site survey finds a sunlit or unheated pull-in point.
- **Enclosure:** a locked metal wall enclosure, made for the chosen model,
  with a rear-camera cut-out, an exposed front NFC area, concealed USB-C
  power and **side privacy hoods**. It is mounted in **portrait** with the
  **top of the screen no higher than 1.22 m** (48 in) above the floor.
  Wall-mounted, not on a pedestal. It must stick out from the wall no more
  than **100 mm** (4 in), or sit in an alcove (§2).
- **Power and network:** wired USB-C power from an outlet behind or just
  below the enclosure, with battery protection on, because the tablet is on
  charge 24/7. Garage Wi-Fi on an **MVTA-managed SSID**. The browser is
  allow-listed to two hosts. The network allow-list is longer, because
  Android, Google Play and Intune need their own hosts (§3).
- **Intune:** Android Enterprise **dedicated device** with **Microsoft Entra
  shared device mode**. Without shared device mode, Conditional Access will
  not let the kiosk account sign in on a dedicated device at all (S23).
  Managed Home Screen shows one pinned app, managed Chrome. Updates install
  overnight (00:30–03:30), and the device can be wiped remotely (§4).
- **The biggest unknown is not hardware.** It is whether **Chrome** on a
  shared-device-mode kiosk passes Conditional Access's compliant-device check
  and keeps Web NFC working. **Prove it on one device before buying the
  fleet** (§4.6, step 4).
- **Badge hardware (eval §3.6 option 2, only if chosen after the pilot):**
  new **NTAG-class NFC fobs**, about $0.10–2 each (S21), read by the
  tablet's own NFC. A USB reader at $180–250 (S20) is needed only for the
  contractor's existing 125 kHz or iCLASS/Seos badges (§5).
- **Cost:** about **$915–2,180 per kiosk** and **$1,830–4,360 per garage**
  (two kiosks), plus **$765–1,180** once for the fleet spare. With G garages,
  that is **G × $1,830–4,360 + $765–1,180** up front. Ongoing costs are about
  **$35–110 per device a year** for licences (§6).

## 1. Tablet shortlist

### What the kiosk needs from the tablet

| Need | Why | Weight |
|---|---|---|
| Glove mode on the touchscreen | Winter pull-ins (eval §5) | Must |
| NFC at 13.56 MHz, **on the front face** | Badge sign-in through the enclosure (eval §3.6). An NFC reader on the back of a wall-mounted tablet cannot be reached | Must for option 2; check the location for each model |
| Rear camera, reachable through an enclosure cut-out | Photos on vehicle condition reports (eval §8) | Must |
| 10" or larger; 11" preferred | Detour maps on the idle screen (eval §8) | Prefer |
| Brightness of 500 nits or more | Garage glare (eval §5) | Prefer |
| Android Enterprise Recommended (AER) | Google's check that the model enrols and updates as Intune expects | Must, or a written statement from the maker |
| At least 4 years of security updates from purchase; 6 or more preferred | The device outlives one contractor (eval §2) | Must |
| Can run on wired power indefinitely | The tablet stays on charge 24/7 | Must: a battery protection mode, or a removable battery |
| Wi-Fi model, no cellular | Garage Wi-Fi only (§3) | Saves cost and a data plan |

### The three candidates

Prices are US reseller or list prices for the **Wi-Fi** model where the
source names it. "Not found" means the research found no figure. It does not
mean the feature is missing.

| | **Samsung Galaxy Tab Active5 Pro** (Enterprise Edition) | **Lenovo ThinkTab X11 Gen 1** | **Zebra ET60** (Wi-Fi) |
|---|---|---|---|
| Screen | 10.1", 1920×1200 (S6) | **10.95"**, 2560×1600, 90 Hz (S7) | 10.1", 1920×1200 (S15) |
| Brightness | Not found; confirm with Samsung | 800 nits peak (S7), but two reviews call it dim (S8, S9) | **1,000 nits** (S15) |
| Glove mode | Yes (S1) | Yes, glove and wet touch (S12) | Yes, **heated** multi-mode touch for bare fingers, gloves or a stylus (S16) |
| NFC at 13.56 MHz | Yes, **front-facing** (S1) | Yes, **front-mounted** (S12) | Yes (S16). Location not found; confirm it is reachable through an enclosure |
| Rear camera | 12 or 13 MP with flash; sources differ (S5) | 13 MP, autofocus, flash (S10) | 16 MP (S16) |
| USB-C ports | 1 | **2** (S12): one for power, one for a badge reader | 1 (check the dock or accessory ports) |
| Wired-power use | Removable battery. Samsung's battery protection limits the charge. Confirm whether the Pro supports "no battery" operation | Battery **removable, and runs with no battery inserted** (S12) | Removable battery. Confirm a fixed-install mode with Zebra |
| Android Enterprise Recommended | **Not confirmed** by this research. Check Google's AER directory | **Not confirmed** (S9) | **Yes** (S14) |
| Security updates | **7 years** from launch under Samsung's 2024 policy (S3); one listing shows the term ending May 2033 (S1) | **Sources disagree**: 4 years of patches (S9, S11) vs 7 years in the EU's EPREL record (S9). Lenovo's own spec points to a support page (S10) | **At least 5 years** under Zebra LifeGuard, with monthly patches (S15) |
| Price, Wi-Fi model | **$599–759**: $599 street (S2), $759 MSRP for 128 GB (S1) | **$439–580**: $439 at Lenovo and $500 MSRP (S8); about $579 suggested retail (S9) | **$1,072–1,766**: $1,227.99 for SKU `-0SQAGS00A0-NA` and $1,765.99 for `-0SQAGSK0C0-NA` (S13) |
| On sale since | 2025 (S3) | US since June 2026 (S8) | 2025 or earlier (S13) |
| Enclosures made for it | Yes, from Compulocks and others (S17) | Few yet, because it is new; a universal enclosure may be needed | From Zebra partners; not researched |

### How they compare

- **Samsung Galaxy Tab Active5 Pro** meets every *must* that was found. Its
  7-year update term is the longest, so a kiosk bought in 2027 is patched to
  about 2032. It has front NFC, and the most enclosures are made for it. Its
  weak points are an unconfirmed brightness figure and AER status that this
  research could not confirm. Samsung's Tab Active line is widely sold for
  Intune kiosks, but **check the AER directory** before ordering.
  Enrolment can use **Samsung Knox Mobile Enrollment**, which is free. It
  lets a tablet enrol itself on first boot.
- **Lenovo ThinkTab X11** is the only 11"-class option. It is the cheapest,
  and its **second USB-C port** and **battery-free operation** suit a wall
  kiosk better than the others. Against it: the update term is unclear (4
  years would mean replacing it about 2030), AER is unconfirmed, it is new
  so few enclosures are made for it, and reviewers find the screen dim.
  Garages are bright, so the dim screen matters.
- **Zebra ET60** is the strongest device on paper: the brightest screen, a
  heated touchscreen, and confirmed AER. It costs about $500–1,000 more per
  kiosk than the Samsung. It earns that only at an unheated or sunlit
  pull-in point.

**The 10" vs 11" question.** The extra 0.85" on the X11 gives about 18% more
screen area. That helps a detour map, but it does not change the ridership
screens, which are sized for 10" portrait (eval §5). A 7-year update term
matters more than 0.85" to a device MVTA must keep for longer than one
contract.

**Recommendation:**

- Standardise on the **Samsung Galaxy Tab Active5 Pro Enterprise Edition,
  Wi-Fi, 128 GB**.
- Before ordering, ask Samsung or the reseller for three things in writing:
  - its AER listing;
  - the screen brightness;
  - whether it supports fixed wired-power operation with no battery.
- Ask Lenovo for the same three things for the **ThinkTab X11**. Switch to
  it only if all three come back good and an enclosure exists.
- Keep the **Zebra ET60** for any garage whose survey finds sun on the screen
  or an unheated pull-in point.
- Use **one model across the fleet**, so that one spare, one enclosure part
  and one Intune profile fit every kiosk.

## 2. Enclosure and mounting

### Wall vs pedestal

| | Wall enclosure | Floor pedestal |
|---|---|---|
| Fixing | Into the wall, near an outlet | Bolted to the floor, cable through the post |
| Floor space | None; the wall must be free | Needs a clear area, which may be scarce on a check-in route |
| Cable routing | Short: the outlet is behind or below | Conduit up the post, and a floor core or surface raceway to an outlet |
| ADA protrusion rule (below) | Must stick out 100 mm or less, or sit in an alcove | A post is not a protruding object; a cane-detectable base meets the rule |
| Cost | Lower (S17, S19) | About $300–700 more for the post and the floor work (*estimate*) |
| Moving it later | Re-drill | Unbolt |

**Use a wall enclosure** wherever the check-in route has a free wall within
2 m of an outlet. Use a pedestal only where there is none, for example in an
open bay.

### What the enclosure must have

- **Made for the chosen model**, not a universal clamp. A universal
  enclosure such as the CTA Digital premium model (S19) is a fallback only.
  It may cover the front NFC area or the camera.
  - The Compulocks **Space** enclosure for the 10.1" Galaxy Tab Active Pro
    costs about $109 (S17). It is listed for the earlier "Active Pro"
    10.1", so confirm the **Active5 Pro** fits before ordering.
  - Compulocks' **Apex** line has tilting mounts for about $209 (S18), but
    the listings found are for the 8" Tab Active.
- **A rear-camera cut-out**, with the flash exposed. On a wall mount the rear
  camera faces the wall, so **decide how a photo is taken** before choosing the enclosure:
  - **(a) A swing or tilt arm.** The operator swings the locked enclosure out
    to point the rear camera at the item. This only works for something
    brought to the kiosk, such as a damaged part.
  - **(b) The front camera**, for a photo held up to the kiosk.
  - **(c) A tethered handheld later.** A vehicle condition photo is usually
    of the bus, which a wall kiosk cannot see.

  This matters for the vehicle condition module (eval §8, Q10). The cheap
  answer is to **buy enclosures with a rear cut-out anyway** (most made-for-
  model enclosures have one; S18) and let Fleet decide later whether photos
  come from the kiosk at all.
- **The front NFC area left open.** Metal over the NFC antenna stops a badge
  read. Check this on a sample before ordering the fleet.
- **A keyed lock**, with two keys per enclosure (S18). MVTA IT holds one and
  the garage manager the other. All kiosks keyed alike, so the spare fits.
- **The home button and the edge buttons covered**, so that an operator
  cannot reach power or volume.
- **Concealed cable routing.** The USB-C power cable runs inside the
  enclosure and out through the back plate into the wall or a raceway. Leave
  space and a second knock-out for an optional **USB badge reader** (§5)
  and, on single-port tablets, a small **USB-C hub with power passthrough**.
- **Side privacy hoods.** No enclosure found includes them (S19). Add two
  side panels about 100 mm deep in sheet metal or polycarbonate, made by the
  enclosure maker or garage facilities. About $50–200 a kiosk (*estimate*).
  They stop the PIN being read from beside the kiosk (eval §5). **Mind the
  protrusion limit below:** hoods count in the depth.
- **A slight tilt back** (about 10–15°) to cut overhead glare, if the
  enclosure and the depth limit allow it.

### ADA placement

These are the 2010 ADA Standards for Accessible Design (§305, §307, §308),
quoted from the standard as known, not re-read for this document. Confirm
them with MVTA's ADA coordinator.

- **Reach.** The highest operable part must be no higher than **1,220 mm
  (48 in)** above the floor, with an unobstructed forward approach (§308.2).
  The operable part here is the whole touchscreen, because the Submit bar
  sits at the bottom and the module tiles can reach the top. A 10.1" tablet
  in portrait has a screen about 217 mm tall (*estimate* from 1920×1200 at
  10.1"). So:
  - **Mount with the screen centre at about 1,100 mm** and the top of the
    screen at about 1,210 mm. That meets 48 in. The eval's "centre at or
    below 1.2 m" is not enough on its own, because a 1.2 m centre puts the
    top above 48 in.
  - The bottom of the screen is then at about 990 mm, which is comfortable
    for standing operators too.
- **Clear floor space.** Leave 760 × 1,220 mm (30 × 48 in) clear in front of
  the kiosk, for a forward approach (§305).
- **Protruding objects.** A wall-mounted object whose leading edge is between
  685 mm and 2,030 mm (27–80 in) above the floor may stick out **no more than
  100 mm (4 in)** into a walkway (§307.2). The enclosure, any tilt and the
  hoods together must stay within 100 mm, or the kiosk must sit in an alcove,
  or have a cane-detectable element below it no higher than 685 mm. **Measure
  this on the sample enclosure.**
- **Two kiosks side by side at the same height**, both accessible. Do not put
  one high and one low.

### Glare

- Mount on a wall **at right angles to** windows and bay doors, never facing
  them or with them behind the operator.
- Avoid a spot directly under a skylight or a bright fitting.
- Fit **matte anti-glare film** on the screen, about $15–40 each
  (*estimate*). Matte film can slightly dull glove touches, so test it with
  gloves on the sample.
- Set brightness by Intune profile (§4): **auto-brightness off, brightness
  at maximum**. The tablet is on mains power, so battery life does not limit
  this.

**Recommendation:**

- A made-for-model locked **wall** enclosure in portrait, with a rear-camera
  cut-out, an open front NFC area, concealed cabling, a second knock-out for
  a reader, side hoods, and kiosks keyed alike.
- Screen top at **1,210 mm or lower**, and **100 mm or less** of protrusion
  in total.
- Buy **one sample enclosure with one tablet first**, and test the fit, NFC
  through the case, the camera, glove touch through the film and the depth
  (step 4).

## 3. Power and network

### Power

- **Wired USB-C power, always on.**
  - A 25 W USB-C PD charger in the outlet behind or below the enclosure.
  - A right-angle USB-C cable inside the enclosure, so it does not stress the
    port.
  - A surface raceway where the outlet is not directly behind.
  - About $40–80 a kiosk (*estimate*).
- **Outlet.** Ideally a dedicated outlet at the mounting position, put in by
  garage facilities' electrician. Where an outlet already exists within the
  raceway's reach, the cost is nil. Allow $0–600 a kiosk (*estimate*) until
  the site survey says.
- **Battery health on 24/7 charge.** A lithium battery kept at 100% swells
  over years. Set Samsung's **battery protection** (charge limit of about
  85%) by Intune or Knox profile. On the ThinkTab X11 the battery can be
  removed and it runs on mains (S12). Inspect the battery when the enclosure
  is opened for anything, and plan a **battery swap at year 3–4** (eval §2).
- **In a power cut:**
  - The tablet runs on its battery for hours. Even at 85% that covers any
    normal cut.
  - But the kiosk is only useful if the **Wi-Fi and the garage's network
    switch stay up too**. If they are on a UPS, sign-in keeps working.
  - If they are not, the kiosk behaves as "network down" (eval §1): an
    operator already signed in can still submit, because Submit is queued
    (D18), and a new sign-in shows "Kiosk offline — hand in your paper
    sheet".
  - **Ask IT whether the garage's access points and switch are on a UPS.**
    No UPS is needed at the kiosk itself.
- **Power over Ethernet** (one cable carrying both power and network,
  through a PoE-to-USB-C splitter) is possible but adds a USB-C hub and an
  Ethernet adapter inside the enclosure. **Use it only where the survey finds
  no outlet nearby and no Wi-Fi signal.**

### Network

| | Garage Wi-Fi | Wired Ethernet (USB-C adapter or PoE) |
|---|---|---|
| Install | None if coverage is good at the spot | A cable pulled to the enclosure |
| Reliability | Depends on coverage near steel buses and bay doors | Best |
| Parts in the enclosure | None | A USB-C hub with Ethernet and power passthrough |
| Intune | A Wi-Fi profile is standard | Android Ethernet works, but is less often managed; test it |

**Use Wi-Fi**, after a coverage check at each spot (step 6).

- **Signal.** Aim for −67 dBm or better at the mounting position, measured
  with buses parked as at the evening wave. Where it is weaker, add an
  access point (about $300–800 installed, *estimate*) rather than run
  Ethernet to the tablet.
- **An MVTA-managed SSID**, not the contractor's network. The contractor's
  network may change on 2027-01-01 (eval §2).
  - It can be a new kiosk SSID, or a kiosk VLAN on an existing MVTA SSID.
  - Use WPA2/WPA3-Enterprise with a **device certificate** pushed by Intune
    (SCEP or PKCS). Then a lost kiosk is cut off by revoking its
    certificate, and there is no shared password to leak. A WPA2-PSK pushed
    by Intune is the simpler fallback.
  - Use client isolation, so kiosks cannot see each other or other devices.
- **Two allow-lists, kept apart:**
  1. **The browser allow-list** (Chrome managed policy, §4): only
     - the **operator site's host** (to be named; eval/#458 step 7), and
     - the **Entra sign-in host** (`login.microsoftonline.com`) and the
       hosts its sign-in page loads from.

     Everything else is blocked in the browser. The REST API host is called
     by the page, not browsed to, so it does not need to be on this list.
  2. **The network egress allow-list** (the firewall on the kiosk VLAN, if IT
     filters egress at all). It must also let the device itself work:
     - Google Play and the Android Management service, for enrolment, app
       updates and system updates;
     - the Intune and Microsoft Authenticator service hosts;
     - Samsung Knox, if Knox Mobile Enrollment or Knox E-FOTA is used;
     - a time service (NTP);
     - the OnBoard REST API host.

     Microsoft and Google publish these lists. IT should use the published
     lists, not hand-typed hosts, because they change.

**Recommendation:**

- A dedicated outlet and wired USB-C power, with battery protection on.
- Garage Wi-Fi on an MVTA kiosk SSID or VLAN with Intune-pushed
  certificates.
- The access points and switch on a UPS, if they are not already.
- The browser allow-listed to the operator site and Entra sign-in only. A
  separate, longer network allow-list from the vendors' published lists.

## 4. Intune enrolment: Android Enterprise dedicated device

### 4.1 Enrolment profile

- **Corporate-owned dedicated device**, with the token type **Microsoft
  Entra shared device mode** (S23).
  - Why shared device mode: Microsoft's documentation says users on
    dedicated devices enrolled **without** it cannot sign in to resources
    protected by Conditional Access, even when the device is compliant
    (S23). The kiosk account's whole design (eval §3.2) rests on Conditional
    Access, so this is not optional.
- **Enrolment method:**
  - **Samsung:** Knox Mobile Enrollment. The reseller registers the serial
    numbers, and the tablet enrols itself on first boot.
  - **Other models:** Android **zero-touch** through the reseller.
  - **Fallback:** the QR code at the welcome screen.
- **One Entra device group** for all kiosks (for example `Kiosks-Operator`).
  Every policy below targets that group, so the spare picks up the same
  setup when it is enrolled.
- **Device name template** `KIOSK-<garage>-<number>`, to match the kiosk
  account (step 8).

### 4.2 Kiosk mode: Managed Home Screen with managed Chrome

- **Multi-app kiosk with Managed Home Screen**, with **one** app pinned:
  **Google Chrome**.
  - Chrome, not Edge, because only Chrome on Android has **Web NFC**
    (eval §3.1, §3.6).
  - Multi-app rather than single-app, because Managed Home Screen hides the
    system settings and status bar and gives IT an exit-kiosk PIN. It also
    lets **Microsoft Authenticator**, the shared-device-mode broker, run
    alongside without being shown.
  - Turn **off** Managed Home Screen's own sign-in screen. The kiosk account
    signs in once, through Authenticator, at enrolment, and stays signed in.
    Operators never see an Entra sign-in. They sign in with the logon ID +
    PIN on the operator site (eval §3.2).
- **Apps from managed Google Play** (required install): Chrome, Microsoft
  Authenticator, Managed Home Screen, and the Intune app.
- **Chrome app configuration policy:**
  - Home page and start page: the operator site.
  - **URL allow-list:** the operator site and the Entra sign-in hosts
    (§3). **URL block-list:** everything else.
  - Incognito off; browser sign-in and sync off; downloads blocked;
    password saving and autofill off; developer tools off.
  - Clear browsing data on exit: the operator site clears its own session
    storage at each operator sign-out (eval §3.4). Chrome's own clearing
    must **not** remove the Entra session or the kiosk's Web NFC
    permission. Test this (step 4).
  - Hide the address bar and tabs where Chrome's managed policies allow it.
    Managed Home Screen keeps the operator out of other apps anyway.
- **Device restrictions profile:**
  - Screen timeout off, or a long timeout with the screen kept on.
  - Brightness at maximum, auto-brightness off (§2).
  - Status bar and notifications hidden.
  - Camera **allowed**, for later modules. USB file transfer and debugging
    **blocked**. Factory reset from the device **blocked**.
  - Battery protection on (§3).

### 4.3 Compliance policy

Applied to the kiosk group. Conditional Access on the kiosk accounts
(step 10) requires a compliant device, so these settings are the device gate:

- minimum OS version: the version the model ships with;
- **security patch level** no older than 90 days;
- **storage encryption** required;
- **Play Integrity** at "strong integrity", which blocks rooted or modified
  devices;
- no device PIN or password required. A dedicated kiosk has no lock screen,
  and requiring one would block the kiosk;
- mark a device non-compliant after a **3-day grace period**, so that one
  missed overnight update does not shut a garage's kiosk.

### 4.4 Overnight updates

- **System updates:** Intune's *windowed* system update policy at **00:30–
  03:30 Central**. Fixed-route service runs 04:00–midnight, so this is
  outside every pull-in wave.
- **App updates** (Chrome, Authenticator, Managed Home Screen) from managed
  Google Play: high-priority auto-update, in the same overnight window where
  Play allows a maintenance window.
- **Firmware pinning** (optional): Samsung **Knox E-FOTA** lets IT hold a
  firmware version until it has been tested on one kiosk. It is worth having
  only if an update ever breaks the kiosk. It is a paid Knox licence, not
  costed here.
- **Order of updates:** let **one kiosk at the pilot garage** take updates a
  week ahead of the rest. If a Chrome update breaks Web NFC or the sign-in,
  only one kiosk is affected.

### 4.5 Lost, stolen or retired

When a kiosk is lost, stolen or retired:

1. **Wipe** it in Intune. For a retired kiosk that is being reused, *retire*
   is enough.
2. **Disable the kiosk's Entra account** (step 8's account).
3. **Revoke its `operator-kiosk` grant** in Access & Identity (eval §3.2).
4. **Revoke its Wi-Fi certificate** (§3).

All four are listed so that no one of them is forgotten. Any one is enough
to stop the device from submitting.

- **Enterprise factory reset protection:** set an MVTA admin account in the
  Intune profile, so that a stolen kiosk cannot be reset and reused.

### 4.6 What must be proved on one device first

These are the parts most likely to fail. None is a purchasing question, but
all of them decide whether the fleet purchase works:

1. **Conditional Access in Chrome.** The kiosk account signs in through
   Chrome to the operator site on a shared-device-mode kiosk, and Conditional
   Access sees the device as compliant. Microsoft documents shared device
   mode for apps that support it (S23). Whether Chrome on a dedicated
   device presents the device's compliance to Entra must be **tested, not
   assumed**.
   - **If it fails:** keep the dedicated device and Chrome. Use a Conditional
     Access **named location** (the garage's public egress address) instead
     of the compliant-device check. That is weaker, because a laptop on the
     garage network would pass. Tell the session that owns eval §3.2, because
     it changes the device-trust design.
2. **Web NFC in managed Chrome:**
   - a tap reads an NTAG fob's serial and NDEF record through the closed
     enclosure;
   - the one-time NFC permission persists across operator sessions and
     across Chrome updates.
3. **Session lifetime.** The kiosk account's session survives a week of
   normal use and an overnight update without IT signing it in again.
4. **Glove touch** through the anti-glare film.

### 4.7 If Android Enterprise is not yet bound in MVTA's tenant (eval Q3)

Most of this is a one-off, about half a day of IT work (*estimate*):

1. **Bind managed Google Play** in the Intune admin centre. This links an
   MVTA-owned Google account to the tenant. Use a shared IT service mailbox,
   never a person's account, so that the binding survives staff changes.
2. **Approve the four apps** listed in §4.2 in managed Google Play.
3. **Create the dedicated-device enrolment profile** with the shared-device-
   mode token (§4.1).
4. **For Samsung:** register in the **Samsung Knox** portal (free) and link
   Knox Mobile Enrollment to the Intune profile. Ask the reseller to upload
   the serial numbers at shipping.
5. **Create the Entra device group** and the policies in §4.2–4.4.
6. **Set the Managed Home Screen exit PIN** and store it in IT's password
   vault.

If Android Enterprise is already bound, only steps 2–6 apply, and step 2 is
whatever is not yet approved.

### 4.8 Licences (eval Q7)

| Licence | For | Cost | Note |
|---|---|---|---|
| **Intune Plan 1 device licence** | Each enrolled kiosk, including the spare once it is enrolled | **$2.70–3.24 per device a month** (S22) | A device licence covers a user-less dedicated device (S24). Microsoft expects the device count to be tracked by hand against the licences bought (S24) |
| **Microsoft Entra ID P1** (on its own, or within a Microsoft 365 or Enterprise Mobility + Security suite MVTA already has) | Each **kiosk account**, because Conditional Access applies to it | $0 if MVTA's agreement already covers it; otherwise about $6 per account a month (*Microsoft list price as remembered, not re-checked; confirm with IT*) | Conditional Access needs Entra ID P1 or P2 (S23). Ask IT whether the kiosk accounts fall under the tenant's existing P1 coverage |
| Samsung Knox Mobile Enrollment | Enrolment | Free | |
| Samsung Knox E-FOTA | Firmware pinning | Paid; not costed | Optional (§4.4) |
| Managed Google Play | Apps | Free | |

So **about $32–39 per device a year** with existing Entra ID P1 coverage, or
**about $105–110** if each kiosk account needs its own P1 licence.

**Recommendation:**

- A dedicated device with **Entra shared device mode**, enrolled through
  Knox Mobile Enrollment.
- Managed Home Screen with **only Chrome** pinned, Chrome allow-listed to two
  hosts, the compliance policy above, updates at 00:30–03:30 Central with one
  canary kiosk, and wipe + disable + revoke on loss.
- **Prove §4.6 on one device before the fleet order.**

## 5. Badge reader hardware (eval §3.6 option 2)

This is needed **only if** badge sign-in is chosen after the pilot (eval §7
step 19). The first release uses the logon ID + PIN and needs none of it.

| | **New NTAG-class NFC fobs**, read by the tablet | **USB keyboard-wedge reader**, for existing badges |
|---|---|---|
| Badge | A new 13.56 MHz NFC fob per operator | The contractor's or MVTA's existing building badge |
| Reader | The tablet's own **front NFC** through Web NFC in Chrome | An rf IDEAS **WAVE ID Plus** keystroke reader, which types the card number like a keyboard |
| Card types | NTAG213/215/216 (NFC Forum Type 2) | 125 kHz proximity **and** 13.56 MHz, on one reader (S20). iCLASS SE and Seos need the SE/Seos variant (S20). **DESFire is not confirmed** for the listed models (S20) |
| Unit cost | **$0.09–0.20** a tag in bulk (S21); key fobs about **£0.75–1.95** each, by quote, with 3–4 weeks lead time (S21) | **$179–251** a reader: $178.54 for the Mini V3 (S20), $207.75 for a surface-mount V2 (S20), $250.59 MSRP for a V2 (S20) |
| Per garage (2 kiosks) | $0 extra hardware | $360–500 for two readers, plus a USB-C hub with power passthrough on single-port tablets ($30–60 each, *estimate*) |
| Fleet issue | 204 operators (eval facts) + about 20% spares ≈ 250 fobs: **about $25–500** | None to issue |
| In the enclosure | Nothing; the tap is on the front face | A reader mounted beside or under the enclosure, with its cable through the second knock-out (§2) |
| Browser | Chrome only (Web NFC) | Any browser; the page needs a focused input to receive the "typed" number |
| Contractor change | MVTA owns the fobs; they stay | The badge numbers change with the contractor (eval §3.6) |
| Copying | NTAG213/215 serials and data can be copied, which is acceptable only because the PIN is still required (eval §3.6) | Depends on the badge; 125 kHz cards are easy to copy |

**Stronger option for later:** **NTAG 424 DNA** fobs. Each tap produces a
new signed URL, which the server can check, so a copied fob does not work.
Web NFC can read that URL. They cost more than NTAG215; get a quote. This is
worth it only if a module later lets a tap stand without the PIN, which eval
§3.6 advises against.

**Recommendation:**

- If option 2 is chosen, use **new NTAG215 key fobs** read by the tablet.
  That means no reader, no cable, and fobs MVTA keeps across contractors,
  for a few hundred dollars for the whole fleet.
- Buy a USB reader **only** if the contractor insists on one card for
  everything (eval Q9). Then buy the WAVE ID Plus variant that matches the
  **actual** card technology, after the contractor names it. Test one on the
  enclosure first.

## 6. Bill of materials and cost

### Per kiosk (recommended Samsung model, wall mount)

| Item | Low | High | Source |
|---|---|---|---|
| Samsung Galaxy Tab Active5 Pro Enterprise Edition, Wi-Fi, 128 GB | $600 | $760 | S1, S2 |
| Made-for-model locked wall enclosure, tilting where available | $110 | $300 | S17, S18; high end allows for a 10" tilting or swing model |
| Side privacy hoods (pair) | $50 | $200 | *estimate* |
| Anti-glare film | $15 | $40 | *estimate* |
| USB-C PD charger, right-angle cable, raceway | $40 | $80 | *estimate* |
| Outlet at the mounting position | $0 | $600 | *estimate*; $0 where one exists |
| Mounting labour (garage facilities, about 2 hours) | $100 | $200 | *estimate* |
| **Kiosk total** | **$915** | **$2,180** | |

### Per garage, fleet and options

| | Low | High |
|---|---|---|
| **Per garage: 2 kiosks** | **$1,830** | **$4,360** |
| **Fleet spare, once:** 1 tablet + 1 enclosure + charger + film, kept unmounted, enrolled and charged | **$765** | **$1,180** |
| *Option: Wi-Fi access point where coverage is weak, per garage* | $300 | $800 |
| *Option: USB badge readers + hubs, per garage (§5)* | $420 | $620 |
| *Option: NTAG215 fobs, whole fleet (§5)* | $25 | $500 |
| *Option: pedestal instead of wall, per kiosk* | $300 | $700 |
| *Swap to Lenovo ThinkTab X11, per kiosk* | −$160 | −$180 |
| *Swap to Zebra ET60, per kiosk* | +$470 | +$1,000 |

The spare is the tablet, enclosure, charger and film from the kiosk table
($765–1,180). It needs no hoods, outlet or labour until it replaces a
broken unit.

**Up front, for G garages:** **G × ($1,830–4,360) + $765–1,180**.

| G | Up front (low – high) |
|---|---|
| 1 | $2,595 – $5,540 |
| 2 | $4,425 – $9,900 |
| 3 | $6,255 – $14,260 |
| 4 | $8,085 – $18,620 |

The wide range is almost all the outlet and enclosure. **The site survey
(step 6) narrows it** more than any price quote does.

### Ongoing, per year

| Item | Per device a year | For G garages (2G + 1 devices) |
|---|---|---|
| Intune device licence (S22) | $32–39 | (2G + 1) × $32–39 |
| Entra ID P1 for the kiosk account, if not already covered | $0–72 (*estimate*) | (2G + 1) × $0–72 |
| Battery swap at year 3–4 (*estimate* $60–120, spread over 3.5 years) | $17–34 | |
| Device replacement at end of security support (7 years for Samsung, S3), spread | $86–110 | Plan, not cash, until year 7 |
| Anti-glare film and hood repair | $5–15 | *estimate* |

So **about $140–270 per device a year**, including a sinking fund for
replacement. The licences alone are $32–111.

**Recommendation:** budget **$2,600–5,600 for the pilot garage plus the
spare**, then **$1,850–4,400 per further garage**, and about **$140–270 per
device a year** ongoing, including replacement. Refine both after the site survey and
a reseller quote.

## 7. Procurement and installation steps (numbered, owner in brackets)

These expand eval §7 steps 1–7, 10 and 19. Identity and role steps are listed
explicitly, as the repo requires.

1. **Confirm the number of garages and the pilot garage** (eval Q1).
   [Operations]
2. **Confirm Android Enterprise in Intune** (eval Q3): is managed Google Play
   bound? If not, do §4.7 step 1. [MVTA IT]
3. **Confirm licensing** (eval Q7): are Intune device licences available, and
   do the kiosk accounts fall under the tenant's Entra ID P1 coverage?
   [MVTA IT]
4. **Buy one sample** of the chosen tablet and enclosure. Enrol it as in §4,
   and prove every item in §4.6 plus §2's fit tests:
   - NFC through the case;
   - the camera cut-out;
   - glove touch through the film;
   - protrusion of 100 mm or less.

   If §4.6 item 1 fails, stop, and take the result back to the owner of eval
   §3.2 before step 11. [MVTA IT, with Engineering for the operator-site
   test page]
5. **Get written answers from the maker** on AER status, brightness, the
   security-update end date and wired-power operation for the chosen model
   (§1). [Procurement]
6. **Site survey at each garage:**
   - the check-in route and the wall, or a pedestal spot;
   - Wi-Fi signal with buses parked;
   - the nearest outlet;
   - glare;
   - floor space and the protrusion limit;
   - whether the access points and switch are on a UPS.

   Record each spot with a photo, with no people in it. [Operations + garage
   facilities + MVTA IT]
7. **Order the fleet:** 2 kiosks per garage plus 1 spare. One model, one
   enclosure SKU, all keyed alike. Ask the reseller to register the serials
   for Knox Mobile Enrollment or zero-touch. [Procurement + MVTA IT]
8. **Create one Entra kiosk account per device** (eval §7 step 6):
   - a non-person account, with no mailbox;
   - named `kiosk-<garage>-<nn>` to match the device name;
   - added to the OnBoard Users group, so that OnBoard sign-in is allowed.

   [MVTA IT]
9. **Assign each kiosk account its licence** (Entra ID P1 coverage, step 3),
   and an Intune device licence to each device. [MVTA IT]
10. **Create the Conditional Access policy** for the kiosk accounts (eval §7
    step 7):
    - require a compliant device (or the named-location fallback, if step 4
      found that compliant-device checks fail in Chrome);
    - no MFA prompt;
    - a session lifetime long enough not to lapse between visits.

    [MVTA IT]
11. **Seed the app-owned role `operator-kiosk`** with the action
    `operator-kiosk.use`, by migration (eval §7 step 8). [Engineering]
12. **Grant `operator-kiosk` to each kiosk account** in Access & Identity,
    with its garage (eval §7 step 9). Record the spare's account too, with no
    garage until it is deployed. [An access administrator]
13. **Network:** create the kiosk SSID or VLAN, the Intune Wi-Fi and
    certificate profiles, and the egress allow-list from the vendors'
    published lists (§3). Add an access point where step 6 found weak
    signal. [MVTA IT]
14. **Power:** put in an outlet at each mounting position where step 6 found
    none. [Garage facilities]
15. **Configure Intune** (§4.2–4.4): the kiosk group, the Managed Home Screen
    profile, the Chrome configuration, device restrictions, the compliance
    policy, the update window with one canary kiosk, and enterprise factory
    reset protection. [MVTA IT]
16. **Enrol each tablet and sign in its kiosk account once**, through
    Authenticator. Check that it reaches the operator site's idle screen and
    sends a heartbeat (eval §1). Label the enclosure with its device name
    only. [MVTA IT]
17. **Mount and install:**
    - the screen top at 1,210 mm or lower, within the 100 mm protrusion
      limit;
    - the film fitted, the cable concealed, and the lock keys logged.

    [Garage facilities, with MVTA IT]
18. **Hand over custody** to the contractor. Garage staff:
    - clean the screen;
    - check that both kiosks show the idle screen at the start of each wave;
    - report faults to MVTA IT the same day;
    - have no admin rights.

    Write this into the procedure (eval §7 step 17) and, if Operations
    agrees, the contract's equipment schedule (eval §7 step 2). [Operations
    + MVTA IT, with Keolis]
19. **Store the spare** enrolled, charged and checked monthly, at MVTA IT or
    the pilot garage. Write down who can swap it in and how its kiosk
    account's garage is changed (step 12). [MVTA IT]
20. **Only if badge sign-in is chosen** after the pilot (eval §7 step 19):
    - **Fobs:** order about 250 NTAG215 fobs and register each to its
      operator at the desk.
    - **Contractor's badges instead:** get the card technology from the
      contractor, buy one matching WAVE ID Plus reader, test it on a kiosk,
      then order one per kiosk.

    [Operations + MVTA IT + Procurement; the desk registers]
21. **Lifecycle:**
    - swap batteries at year 3–4;
    - plan replacement before the security-update end date from step 5;
    - on any loss or retirement, do all four steps in §4.5.

    [MVTA IT]

## Open questions (hardware)

These add to eval Q1–Q10.

| # | Question | For |
|---|---|---|
| H1 | Is the Galaxy Tab Active5 Pro (or the ThinkTab X11) on Google's Android Enterprise Recommended list, and what is its security-update end date? | Procurement, from the maker |
| H2 | How will vehicle condition photos be taken: from a swing-out kiosk, the front camera, or a separate handheld? This decides the enclosure type (§2) | Fleet (with eval Q10) |
| H3 | Are each garage's Wi-Fi access points and network switch on a UPS? | MVTA IT |
| H4 | Does MVTA's agreement cover Entra ID P1 for non-person kiosk accounts? (This sharpens eval Q7) | MVTA IT |
| H5 | Who holds the second enclosure key at each garage? | Operations |

## Sources

All read on **2026-10-31** through web search result summaries. The figures
were not re-read from the full pages, so confirm each one with a quote.

| # | Source | Used for |
|---|---|---|
| S1 | SHI public sector, Samsung Galaxy Tab Active5 Pro — https://www.publicsector.shidirect.com/product/50288763/Samsung-Galaxy-Tab-Active5-Pro | $759 MSRP (128 GB); glove mode; front NFC; security update term to May 2033 |
| S2 | Kimovil, Galaxy Tab Active5 Pro — https://www.kimovil.com/en/where-to-buy-samsung-galaxy-tab-active5-pro | $599, Wi-Fi model |
| S3 | Samsung Canada, Galaxy Tab Active5 Pro Enterprise Edition — https://www.samsung.com/ca/business/tablets/galaxy-tab-active/galaxy-tab-active5-pro-enterprise-edition-sm-x358uzgan45/ | 7 years of security updates (2024 policy); 3-year product life-cycle commitment; on sale from 2025 |
| S4 | Notebookcheck, Galaxy Tab Active5 Pro review — https://www.notebookcheck.net/Samsung-Galaxy-Tab-Active5-Pro-review-Long-lasting-tablet-with-8-years-of-updates-and-a-replaceable-battery.1046345.0.html | Long update life; replaceable battery |
| S5 | Gizbot — https://www.gizbot.com/tablet/news/samsung-galaxy-tab-active5-pro-rugged-tablet-with-snapdragon-7s-gen-3-soc-ip68-rating-launched-011-113375.html, and Technave — https://technave.com/gadget/Samsung-Galaxy-Tab-Active-5-Pro-Price-in-Malaysia-Specs-42229.html | Rear camera 13 MP vs 12 MP |
| S6 | FoneArena, Galaxy Tab Active5 Pro announcement — https://www.fonearena.com/blog/?p=451213 | 10.1" WUXGA |
| S7 | GSMArena, Lenovo ThinkTab X11 Gen 1 — https://www.gsmarena.com/lenovo_thinktab_x11_gen_1-14576.php | 10.95", 2560×1600, 90 Hz, 800 nits peak |
| S8 | XDA Developers, ThinkTab X11 review — https://www.xda-developers.com/review-thinktab-x11-gen-1/ | US since June 2026; $500 MSRP; $439 at Lenovo; screen could be brighter |
| S9 | Notebookcheck, ThinkTab X11 review — https://www.notebookcheck.net/A-tablet-first-that-has-everything-covered-thanks-to-two-USB-ports-5G-a-stylus-Lenovo-ThinkTab-X11-review.1321247.0.html | About $579; 3 Android versions + 4 years of patches vs 7 years in EPREL; NFC; low brightness |
| S10 | Lenovo PSREF, ThinkTab X11 Gen 1 spec — https://psref.lenovo.com/syspool/Sys/PDF/ThinkTab_Tablets/ThinkTab_X11_Gen_1/ThinkTab_X11_Gen_1_Spec.pdf | 13 MP rear camera; update plan referred to a support page |
| S11 | Digitec, ThinkTab X11 test — https://www.digitec.ch/en/page/lenovo-thinktab-x11-tested-robust-tablet-with-a-removable-battery-43836 | 2 Android upgrades, 4 years of patches |
| S12 | TechRadar, ThinkTab X11 review — https://www.techradar.com/pro/phone-communications/lenovo-thinktab-x11-gen-1-rugged-tablet-review, and Yahoo Tech, MWC 2026 launch — https://tech.yahoo.com/computing/articles/lenovo-unveils-thinktab-x11-rugged-172000180.html | Glove and wet touch; front NFC; removable battery, runs with none; two USB-C ports |
| S13 | CDW, Zebra ET60 — https://cdw.com/product/zebra-et6x-series-tablet-et60-tablet/7918608, and CDW Zebra tablets — https://www.cdw.com/category/computers/tablets/?b=ZEB&w=CC | $1,765.99 (`ET60AW-0SQAGSK0C0-NA`, backordered); $1,227.99 (`ET60AW-0SQAGS00A0-NA`); other ET60 Wi-Fi listings from $1,071.99 |
| S14 | Zebra, AER certification flyer — https://prod-www.zebra.com/content/dam/zebra_dam/en/flyer/mobile-computers-flyer-google-aer-certification-en-us.pdf | Android Enterprise Recommended |
| S15 | Zebra, ET60/ET65 "why upgrade" flyer — https://prod-www.zebra.com/content/dam/zebra_dam/en/flyer/et60-et65-flyer-why-upgrade-l10-en-us.pdf | 1,000 nits standard; LifeGuard monthly patches, at least 5 years |
| S16 | Delfi, Zebra ET60 — https://shop.delfi.com/en/product/zebra-et60-android-257cm-101-camera-front-camera-usb-usb-c-bt-wi-fi-nfc-android-gms, and Avoira, Zebra ET60 — https://shop.avoira.com/catalog/product/view/id/9213980/category/3 | 16 MP rear; NFC; heated multi-mode touch (bare, glove, stylus) |
| S17 | SHI, Compulocks Galaxy Tab Active Pro 10.1" Space Enclosure Wall Mount — https://www.shi.com/product/44666340/Compulocks-Galaxy-Tab-Active-Pro-10.1-inch-Space-Enclosure-Wall-Mount | $109 MSRP |
| S18 | SHI, Compulocks Apex Galaxy Tab Active 3/5 8" Enclosure Tilting Wall Mount — https://www.shi.com/product/49682099/Compulocks-Apex-Galaxy-Tab-Active-35-8-inch-Apex-Enclosure-Tilting-Wall-Mount, and CDW-G Apex wall mount — https://cdwg.com/product/compulocks-apex-galaxy-tab-active-3-5-8-apex-enclosure-wall-mount-mounting/8226756 | $209 MSRP tilting; front and rear cameras exposed; two keys |
| S19 | CDW, CTA Digital Premium Universal Security Wall & Desk Enclosure — https://www.cdw.com/product/cta-premium-universal-security-wall-desk-enclosure-for-ipad-10.2-more/6186500 | About $106; universal fallback; no privacy hood found in any listing |
| S20 | CDW-G, rf IDEAS WAVE ID Plus Mini V3 — https://www.cdwg.com/product/rf-ideas-wave-id-plus-mini-v3-usb-keystroke-with-6-cable-reader-black/7250488; Spartan POS, WAVE ID Plus Keystroke surface mount — https://spartanpos.com/products/rfideas-wave-id-plus-keystroke-surface-mount-black-usb-reader-rdr-805w1bku; SHI, WAVE ID Plus Keystroke V2 — https://texas.gs.shi.com/product/47432907/rf-IDEAS-WAVE-ID-Plus-Keystroke-V2 | $178.54; $207.75; $250.59 MSRP; 125 kHz + 13.56 MHz; iCLASS SE/Seos variant; DESFire not confirmed |
| S21 | ABCRFID, NTAG215 tag — https://www.abcrfid.com/?p=1339, and Eccel, NFC key fob — https://eccel.co.uk/product/rfid-nfc-key-fob-ntag213/ | $0.20 single to $0.09 at 1,000 tags; key fobs £0.75–1.95 by quote, 3–4 weeks lead time |
| S22 | Mobile Mentor, Intune licensing 2026 — https://www.mobile-mentor.com/insights/the-guide-to-understanding-microsoft-intune-licensing-in-2026/, and 365cloudstore, Intune Plan 1 device licence — https://365cloudstore.com/product/microsoft-intune-plan-1-device-subscription-license/ | $2.70–3.24 per device a month |
| S23 | Microsoft Learn, Android Enterprise compliance settings — https://learn.microsoft.com/en-us/intune/device-security/compliance/ref-android-enterprise-settings | Dedicated devices without Entra shared device mode cannot sign in to Conditional Access–protected resources; Conditional Access needs Entra ID P1/P2 |
| S24 | Microsoft Q&A, device-based licences for Intune — https://learn.microsoft.com/en-us/answers/questions/5639910/detailed-explanation-of-how-device-based-licenses | A device licence per dedicated device; track the device count by hand (a community answer, not official) |
