package com.taskr.core;

import com.taskr.core.Controllers.HouseholdController;
import com.taskr.core.Controllers.UserController;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class HouseholdControllerTest {
    
    @Test
    public void shouldRetrieveAllHousehold() {
        UserStorage userStorage = mock(UserStorage.class);
        TaskTemplateStorage taskTemplateStorage = mock(TaskTemplateStorage.class);
        HouseholdController underTest = new HouseholdController(userStorage, taskTemplateStorage);
        User testUser = new User("Aloo");
        when(userStorage.findAll()).thenReturn(Collections.singletonList(testUser));
        Iterable<User> users = underTest.retrieveAllHousehold();
        assertThat(users).contains(testUser);
    }
}
