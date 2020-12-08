package com.taskr.core;

import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.storages.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
public class JPAWiringTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private UserStorage userStorage;// = new UserStorage(userRepo);

    @Autowired
    private TaskTemplateStorage taskTemplateStorage;// = new TaskTemplateStorage(taskTemplateRepo, userRepo, taskRepo, userStorage, taskStorage);

    @Autowired
    private ResourceManager resourceManager;

    @Test
    public void userStorageShouldSaveAndRetrieveUsersAndTasks() {
        User testUser = new User("user");

        userStorage.save(testUser);

        entityManager.flush();
        entityManager.clear();

        User retrievedUser = userStorage.findUserByName(testUser.getName());

        assertThat(retrievedUser).isEqualTo(testUser);

    }

    @Test
    public void taskTemplateShouldContainListOfUsersWhoCannotDoThatTask() {
        User mom = new User("Mom", 300, "pink", "mom.ico");
        System.out.println(mom.toString());
        userStorage.save(mom);
        System.out.println(mom.toString());
        TaskTemplate cleanCommonArea = new TaskTemplate("Clean Common Area", "Clean all common areas", 30, 30);
        cleanCommonArea.addUserWhoCannotDoThisTask(mom);
        taskTemplateStorage.save(cleanCommonArea);
        userStorage.save(mom);
//        assertThat(userStorage.findById(mom.getId()).getTasksUserCannotDo()).contains(taskTemplateStorage.findById(cleanCommonArea.getId()));
    }
}
