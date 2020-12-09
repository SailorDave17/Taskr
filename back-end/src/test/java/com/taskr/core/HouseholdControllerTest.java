package com.taskr.core;

import com.taskr.core.controller.HouseholdController;
import com.taskr.core.model.User;
import com.taskr.core.storage.TaskStorage;
import com.taskr.core.storage.TaskTemplateStorage;
import com.taskr.core.storage.UserStorage;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class HouseholdControllerTest {
    
    @Test
    public void shouldRetrieveAllHousehold() {
        TaskStorage taskStorage = mock(TaskStorage.class);
        UserStorage userStorage = mock(UserStorage.class);
        ResourceManager resourceManager = mock(ResourceManager.class);
        TaskTemplateStorage taskTemplateStorage = mock(TaskTemplateStorage.class);
        HouseholdController underTest = new HouseholdController(taskStorage, userStorage, taskTemplateStorage, resourceManager);
        User testUser = new User("Aloo");
        when(userStorage.findAll()).thenReturn(Collections.singletonList(testUser));
        Iterable<User> users = underTest.retrieveAllHousehold();
        assertThat(users).contains(testUser);
    }
}
