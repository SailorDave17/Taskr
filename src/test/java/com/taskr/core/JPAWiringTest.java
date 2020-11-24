package com.taskr.core;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
public class JPAWiringTest {

    @Autowired
    private HouseholdRepository householdRepo;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    public void householdRepoShouldSaveAndRetrieveUsersAndTasks() {
        Household testHousehold = new Household("user", "task");

        householdRepo.save(testHousehold);

        entityManager.flush();
        entityManager.clear();

        Household retrievedHousehold = householdRepo.findById(testHousehold.getId()).get();

        assertThat(retrievedHousehold).isEqualTo(testHousehold);

    }
}
