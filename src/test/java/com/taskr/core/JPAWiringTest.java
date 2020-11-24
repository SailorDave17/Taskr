package com.taskr.core;

import com.taskr.core.Resources.User;
import com.taskr.core.Storages.UserRepository;
import com.taskr.core.Storages.UserStorage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
public class JPAWiringTest {


    @Autowired
    private UserStorage userStorage;

    @Autowired
    private TestEntityManager entityManager;

    @Test
    public void userStorageShouldSaveAndRetrieveUsersAndTasks() {
        User testUser = new User("user");

        userStorage.save(testUser);

        entityManager.flush();
        entityManager.clear();

        User retrievedUser = userStorage.findById(testUser.getId());

        assertThat(retrievedUser).isEqualTo(testUser);

    }
}
