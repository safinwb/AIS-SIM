# AIS Simulator

**Simulate AIS or TTM targets over UDP or TCP (Serial coming soon)**

Choose AIS or TTM in the bottom panel, then choose UDP or TCP and Client or Server. Enter a host and port, then click the link button. TCP Server sends the selected NMEA sentences to every connected client. TTM sentences use the `$RATTM` header and report each target relative to the simulated own ship. Each target receives a stable random ID in the TTM target-name field; vessel names are not transmitted in TTM.

Check **Transmit GPS** to send `$GPGGA`, `$GPRMC`, `$GPHDT`, and `$GPVTG` for the simulated own ship over the same active UDP or TCP connection. Click the rate button to cycle through 10, 1, and 5 Hz. The simulated GGA fix uses quality 8 (simulator mode), eight satellites, HDOP 0.9, and zero altitude and geoid separation. UTC time and date come from the computer clock.

The simulated own ship starts at 25°31'16.4"N 56°22'45.1"E, pointing north. Use the Own Ship controls to set speed from 0 to 30 kn and a target heading. It turns toward that heading at up to 15° per second and moves continuously. Drag the own-ship icon to change its position. Own ship is shown on the map but is not sent as an AIS target.

For OpenCPN, configure a NMEA 0183 UDP input on the same port as AIS-SIM's UDP Client output (9200 by default). Select TTM and enable Transmit GPS. OpenCPN places TTM targets relative to its selected own-ship position, so choose AIS-SIM's GPS feed as the position source when other GPS feeds are also connected. Use OpenCPN's NMEA Debug window to confirm that repeated `$RATTM` and `$GPRMC` sentences arrive.

<img width="1589" height="942" alt="Screenshot from 2026-04-03 10-20-48" src="https://github.com/user-attachments/assets/85cd0053-2ce6-44f2-adb1-18a5dfa54691" />
