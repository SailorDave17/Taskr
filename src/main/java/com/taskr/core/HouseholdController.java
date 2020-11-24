package com.taskr.core;


import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HouseholdController {

    HouseholdRepository householdRepo;

    public HouseholdController(HouseholdRepository householdRepo) {
        this.householdRepo = householdRepo;
    }

    @GetMapping("/api/household")
    public Iterable<Household> retrieveAllHousehold(){

        return householdRepo.findAll();

    }

    @GetMapping("/api/household/(id)")
    public Household retrieveHouseholdById(Long id){

        return householdRepo.findById(id).get();
    }

}
