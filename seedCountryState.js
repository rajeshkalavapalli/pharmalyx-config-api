const {
    getCountries,
    getStatesOfCountry,
} = require("@countrystatecity/countries");

const {
    customQuery,
} = require("./utils/dbFunctions");

const {
    generateUUID,
} = require("./utils/commonUtils");


async function seedCountryState() {

    try {

        // ============================================
        // GET ALL COUNTRIES
        // ============================================

        const countries = await getCountries();

        console.log(
            `Total countries found: ${countries.length}`
        );


        // ============================================
        // LOOP THROUGH COUNTRIES
        // ============================================

        for (const country of countries) {

            // ========================================
            // CHECK COUNTRY ALREADY EXISTS
            // ========================================

            const existingCountry = await customQuery(
                `
                    SELECT CountryId
                    FROM country
                    WHERE CountryCode = @CountryCode
                `,
                {
                    CountryCode: country.iso2,
                }
            );


            let countryId;


            // ========================================
            // INSERT COUNTRY IF NOT EXISTS
            // ========================================

            if (existingCountry.length === 0) {

                countryId = generateUUID();

                await customQuery(
                    `
                        INSERT INTO country (
                            CountryId,
                            CountryName,
                            CountryCode,
                            PhoneCode,
                            IsActive,
                            CreatedOn,
                            ModifiedOn
                        )
                        VALUES (
                            @CountryId,
                            @CountryName,
                            @CountryCode,
                            @PhoneCode,
                            @IsActive,
                            GETDATE(),
                            GETDATE()
                        )
                    `,
                    {
                        CountryId: countryId,
                        CountryName: country.name,
                        CountryCode: country.iso2,
                        PhoneCode: country.phonecode,
                        IsActive: true,
                    }
                );

                console.log(
                    `Country inserted: ${country.name}`
                );

            } else {

                countryId =
                    existingCountry[0].CountryId;

                console.log(
                    `Country already exists: ${country.name}`
                );

            }


            // ========================================
            // GET STATES FOR COUNTRY
            // ========================================

            const states =
                await getStatesOfCountry(
                    country.iso2
                );


            // ========================================
            // LOOP THROUGH STATES
            // ========================================

            for (const state of states) {

                // ====================================
                // CHECK STATE ALREADY EXISTS
                // ====================================

                const existingState =
                    await customQuery(
                        `
                            SELECT StateId
                            FROM state
                            WHERE StateCode = @StateCode
                            AND CountryId = @CountryId
                        `,
                        {
                            StateCode: state.iso2,
                            CountryId: countryId,
                        }
                    );


                // ====================================
                // INSERT STATE IF NOT EXISTS
                // ====================================

                if (existingState.length === 0) {

                    const stateId =
                        generateUUID();


                    await customQuery(
                        `
                            INSERT INTO state (
                                StateId,
                                StateName,
                                StateCode,
                                CountryId,
                                IsActive,
                                CreatedOn,
                                ModifiedOn
                            )
                            VALUES (
                                @StateId,
                                @StateName,
                                @StateCode,
                                @CountryId,
                                @IsActive,
                                GETDATE(),
                                GETDATE()
                            )
                        `,
                        {
                            StateId: stateId,
                            StateName: state.name,
                            StateCode: state.iso2,
                            CountryId: countryId,
                            IsActive: true,
                        }
                    );

                    console.log(
                        `   State inserted: ${state.name}`
                    );

                }

            }

        }


        console.log(
            "\nCountry and State seeding completed successfully."
        );

    } catch (error) {

        console.error(
            "Error seeding country and state data:",
            error
        );

    }

}


seedCountryState();