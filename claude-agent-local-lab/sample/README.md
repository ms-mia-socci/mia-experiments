# Shop shipping configuration

The checkout service consumes `shipping.json`.

Product requirements:
- Standard shipping costs $7 for orders below $50.
- Orders of $50 or more receive free standard shipping.
- Express shipping always costs $15.
- Currency is USD.

There is a bug in the current configuration. Investigate it, propose a fix, and run the managed shipping tests before and after the change.
