
module.exports={
CREATE_PHARMACY: ()=>{
    return `
    INSERT INTO Pharmacy (
    PharmacyId ,
    PharmacyName ,
    OwnerName ,
    ContactNumber,
    EmailId ,
    DrugLicenceNumber,
    GSTIN,
    CountryId,
    StateId,
    TerritoryId,
    AreaId,
    Address,
    IsActive,
    CreatedOn,
    ModifiedOn

    )
    VALUES (
        @PharmacyId,
        @PharmacyName,
        @OwnerName,
        @ContactNumber,
        @EmailId,
        @DrugLicenceNumber,
        @GSTIN,
        @CountryId,
        @StateId,
        @TerritoryId,
        @AreaId,
        @Address,
        @IsActive,
        @CreatedOn,
        @ModifiedOn
    )
    `
},
GET_PHARMACIES: ()=>{
    return `
    SELECT
        p.*,
        t.TerritoryName
    FROM Pharmacy p
    LEFT JOIN Territory t ON t.TerritoryId = p.TerritoryId
    `
},
GET_PHARMACY_BY_ID: ()=>{
    return `
    SELECT *
    FROM Pharmacy
    WHERE PharmacyId = @pharmacyId
    `
},
UPDATE_PHARMACY: ()=>{
    return `
    UPDATE Pharmacy
    SET 
        PharmacyName = @PharmacyName,
        OwnerName = @OwnerName,
        ContactNumber = @ContactNumber,
        EmailId = @EmailId,
        DrugLicenceNumber = @DrugLicenceNumber,
        GSTIN = @GSTIN,
        CountryId = @CountryId,
        StateId = @StateId,
        TerritoryId = @TerritoryId,
        AreaId = @AreaId,
        Address = @Address,
        IsActive = @IsActive,
        ModifiedOn = @ModifiedOn
    WHERE PharmacyId = @pharmacyId
    `
},
DELETE_PHARMACY: ()=>{
    return `
    DELETE FROM Pharmacy
    WHERE PharmacyId = @pharmacyId
    `
}
}