package com.taskr.core.storages;

import com.taskr.core.ResourceManager;
import com.taskr.core.resources.TaskTemplate;
import com.taskr.core.resources.User;
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
    private UserRepository userRepo;

    @Autowired
    private TaskTemplateRepository taskTemplateRepo;

    @Autowired
    private TaskRepository taskRepo;

    @Test
    public void userStorageShouldSaveAndRetrieveUsersAndTasks() {
        User testUser = new User("user");

        userRepo.save(testUser);

        entityManager.flush();
        entityManager.clear();

        User retrievedUser = userRepo.findById(testUser.getId()).get();

        assertThat(retrievedUser).isEqualTo(testUser);

    }

    @Test
    public void taskTemplateShouldContainListOfUsersWhoCannotDoThatTask() {
        User mom = new User("Mom", 300, "pink", "mom.ico");
        System.out.println(mom.toString());
        userRepo.save(mom);
        System.out.println(mom.toString());
        TaskTemplate cleanCommonArea = new TaskTemplate("Clean Common Area", "Clean all common areas", 30, 30);
        cleanCommonArea.addUserWhoCannotDoThisTask(mom);
        taskTemplateRepo.save(cleanCommonArea);
        userRepo.save(mom);
        assertThat(mom.getTasksUserCannotDo()).contains(taskTemplateRepo.findById(cleanCommonArea.getId()).get());
        assertThat(cleanCommonArea.getUsersWhoCannotDoThisTask()).contains(userRepo.findById(mom.getId()).get());
    }
}
