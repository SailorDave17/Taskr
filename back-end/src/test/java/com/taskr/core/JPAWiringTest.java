package com.taskr.core;

import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskTemplateRepository;
import com.taskr.core.Storages.TaskTemplateStorage;
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
    private UserRepository userRepo;
    @Autowired
    private TaskTemplateRepository taskTemplateRepo;

    @Autowired
    private TestEntityManager entityManager;

    private UserStorage userStorage = new UserStorage(userRepo, taskTemplateRepo);

    @Test
    public void userStorageShouldSaveAndRetrieveUsersAndTasks() {
        User testUser = new User("user");

        userRepo.save(testUser);

        entityManager.flush();
        entityManager.clear();

        User retrievedUser = userRepo.findUserByName(testUser.getName());

        assertThat(retrievedUser).isEqualTo(testUser);

    }
}
