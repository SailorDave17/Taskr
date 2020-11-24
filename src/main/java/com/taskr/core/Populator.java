package com.taskr.core;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;

public class Populator implements CommandLineRunner {

    @Autowired
    HouseholdRepository householdRepo;
    @Override
    public void run(String... args) throws Exception {
        Household testHousehold = new Household("sample user", "sample task");

        householdRepo.save(testHousehold);
    }
}
