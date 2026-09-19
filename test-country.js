const {
  getCountries,
  getStatesOfCountry,
} = require("@countrystatecity/countries");

async function testData() {
  const countries = await getCountries();

  const india = countries.find(
    (country) => country.iso2 === "IN"
  );

  console.log("India:", india);

  const states = await getStatesOfCountry("IN");

  console.log(states.slice(0, 5));
}

testData();